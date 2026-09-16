// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { Node, NodeId } from '@/scene/types'
import { addKeyframe } from '@/anim/tracks'
import { distributeTransforms, type DistributedTransform } from '@/scene/gridDistribution'
import { uniqueNodeName } from '@/scene/uniqueNodeName'

/**
 * "Perspective" templates — a multi-slot 3D arrangement you drop media
 * into, with a baked camera-style motion, packaged as one insert action.
 * Each slot is an ordinary `clipsContent` frame (same pattern device
 * mockups already use for their Screen): dropping an image onto one
 * reparents it in as a child (see dropTargetFrame.ts), filling the slot,
 * rather than needing a bespoke "replace this slot" mechanic.
 *
 * The whole arrangement is meant to be edited as ONE asset, not by
 * hand-tuning each slot individually — `insertPerspectiveTemplate` tags
 * the outer container with its live params (radius, card roundness,
 * slot count, spin speed), and `applyPerspectiveTemplateParams`
 * regenerates the whole arrangement from an edited copy of those params.
 * Regenerating only touches each slot's position/rotation/size/
 * roundness — it never deletes or recreates a slot that already has
 * media in it, so dragging "Radius" around doesn't wipe out cards
 * you've already filled. Slots are only added (when slotCount
 * increases) or removed from the end (when it decreases).
 *
 * Each template's `arrangement` and `animation` are fixed per kind (not
 * user-editable — they define what the template IS), while radius,
 * card size/roundness, slot count, and spin/columns are exposed as live
 * params. Adding a new template kind means adding one
 * PERSPECTIVE_TEMPLATES entry; the insert/regenerate logic below
 * already branches on `arrangement`/`animation` generically.
 */

export type PerspectiveTemplateKind = 'card-tunnel' | 'orbit-globe' | 'totem-wall'

/** How slots are laid out in space. Fixed per template kind. */
export type PerspectiveArrangement = 'ring' | 'bands' | 'grid'

/** What (if anything) the container keyframes on its own. Fixed per template kind. */
export type PerspectiveAnimation = 'spin-y' | 'none'

export interface PerspectiveTemplateParams {
  // Widened to `string` (not `PerspectiveTemplateKind`) so this type
  // round-trips through FrameNode['perspectiveTemplate'] without a
  // cast — that field is deliberately plain-string-typed for the same
  // layering reason as `deviceMockupKind` (see its doc comment).
  kind: string
  /** Distance from the ring/sphere's center, in canvas pixels. Unused by grid arrangement. */
  radius: number
  slotWidth: number
  slotHeight: number
  slotCornerRadius: number
  slotCount: number
  /** Seconds for one full spin cycle. Unused when animation is 'none'. */
  spinDuration: number
  /** Columns per row. Only meaningful for grid arrangement. */
  gridColumns: number
  /** Gap between grid cells, in canvas pixels. Only meaningful for grid arrangement. */
  gridGap: number
}

export interface PerspectiveTemplateSpec extends PerspectiveTemplateParams {
  label: string
  arrangement: PerspectiveArrangement
  animation: PerspectiveAnimation
  /** Slot placeholder fill before an image is dropped in. */
  slotColor: string
  /**
   * A thin placeholder-only border. Without it, a cluster of same-color
   * slots with no image dropped in yet — especially many small,
   * rounded, closely-packed ones like Orbit Globe's — melts into a
   * single undifferentiated blob against the canvas instead of reading
   * as individual cards.
   */
  slotStrokeColor: string
}

export const PERSPECTIVE_TEMPLATES: Record<PerspectiveTemplateKind, PerspectiveTemplateSpec> = {
  'card-tunnel': {
    kind: 'card-tunnel',
    label: 'Card Tunnel',
    arrangement: 'ring',
    animation: 'spin-y',
    slotCount: 8,
    slotWidth: 130,
    slotHeight: 170,
    radius: 260,
    slotColor: '#1c1c1e',
    slotStrokeColor: '#3f3f46',
    slotCornerRadius: 10,
    spinDuration: 10,
    gridColumns: 3,
    gridGap: 16,
  },
  'orbit-globe': {
    kind: 'orbit-globe',
    label: 'Orbit Globe',
    arrangement: 'bands',
    animation: 'spin-y',
    slotCount: 20,
    slotWidth: 44,
    slotHeight: 44,
    radius: 170,
    slotColor: '#2a2a32',
    slotStrokeColor: '#55555f',
    slotCornerRadius: 22,
    spinDuration: 16,
    gridColumns: 3,
    gridGap: 16,
  },
  'totem-wall': {
    kind: 'totem-wall',
    label: 'Totem Wall',
    arrangement: 'grid',
    animation: 'none',
    slotCount: 9,
    slotWidth: 130,
    slotHeight: 130,
    radius: 260,
    slotColor: '#1c1c1e',
    slotStrokeColor: '#3f3f46',
    slotCornerRadius: 8,
    spinDuration: 10,
    gridColumns: 3,
    gridGap: 16,
  },
}

/** Container yaw baked in at insert time for grid-arrangement templates, so a Totem Wall reads as a wall seen at an angle (its z-staggered columns actually foreshorten) instead of a flat frontal grid indistinguishable from an ordinary layout. Purely a starting pose — the container itself isn't locked, so the user can still rotate it by hand afterward. */
const GRID_DEFAULT_YAW = -16


const EMPTY_APPEARANCE = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  blendMode: 'normal' as const,
  effects: [],
}

const IDENTITY_TRANSFORM = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
}

function emptySlotAppearance(spec: PerspectiveTemplateSpec, cornerRadius: number) {
  return {
    ...EMPTY_APPEARANCE,
    fill: { kind: 'solid' as const, color: spec.slotColor },
    stroke: {
      color: spec.slotStrokeColor,
      width: 1,
      align: 'inside' as const,
      style: 'solid' as const,
      dashLength: 4,
      dashGap: 4,
    },
    cornerRadius,
  }
}

/**
 * Row-major grid, centered on (0, 0), with each column stepped back in
 * depth from the next ("totem" columns receding into the scene) — a
 * flat, unstaggered z:0 grid is geometrically indistinguishable from an
 * ordinary 2D layout and doesn't read as belonging in a "Perspective"
 * category at all. Combined with the container's baked-in yaw
 * (GRID_DEFAULT_YAW), the columns visibly foreshorten instead of
 * sitting in one dead-flat plane.
 *
 * Sorted back-to-front by z before returning, matching
 * sphericalTransforms' reasoning in gridDistribution.ts: this renderer
 * paints planes in creation order with no z-buffer, so whichever
 * column is nearer the camera needs to be created (and thus painted)
 * last to legibly sit in front of the one behind it. Unlike the
 * spinning arrangements, a static wall's paint order stays correct
 * forever once sorted — nothing here ever re-animates the depth axis.
 *
 * Not general enough to belong in gridDistribution.ts's "arrange
 * selected layers around a shape" model — this is specifically "lay
 * out N fresh slots in a wall," with a wall-specific depth cue baked
 * in, not a general planar grid.
 */
function gridSlotTransforms(
  count: number,
  columns: number,
  cellWidth: number,
  cellHeight: number,
  gap: number,
): DistributedTransform[] {
  const cols = Math.max(1, columns)
  const rows = Math.ceil(count / cols)
  const totalWidth = cols * cellWidth + (cols - 1) * gap
  const totalHeight = rows * cellHeight + (rows - 1) * gap
  const depthStep = cellWidth * 0.4
  const out: DistributedTransform[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    out.push({
      x: -totalWidth / 2 + col * (cellWidth + gap) + cellWidth / 2,
      y: -totalHeight / 2 + row * (cellHeight + gap) + cellHeight / 2,
      z: (col - (cols - 1) / 2) * depthStep,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
    })
  }
  out.sort((a, b) => b.z - a.z)
  return out
}

/**
 * A handful of horizontal, evenly-spaced rings stacked at different
 * heights and radii — like lines of latitude on a globe, or a disco
 * ball — rather than a Fibonacci-sphere scatter of individually-tilted
 * cards.
 *
 * A dense Fibonacci sphere was the first design here and it looked
 * broken: Fibonacci sampling packs points arbitrarily close together
 * in azimuth, so some points always land almost exactly on the
 * "silhouette rim" as seen from the camera (where a flat card's
 * outward normal is perpendicular to the view direction) and
 * foreshorten to an invisible sliver. An *evenly-spaced* ring can't do
 * that — the worst-placed card is always at least half the ring's
 * angular step away from the rim, which is exactly why Card Tunnel (a
 * single such ring) already reads fine. Stacking several of these
 * proven-good rings at latitudes following a sphere's radius profile
 * (`bandRadius = radius * cos(latitude)`) gets the rounded "globe"
 * silhouette without reintroducing the sliver problem. Every card
 * stays upright (no rotationX tilt) — visually closer to a gyroscope
 * of rings than a literal geodesic sphere, but far more legible in a
 * renderer with no per-frame depth sort.
 *
 * Slots are still sorted back-to-front by z before returning: distinct
 * bands can still overlap in depth near the ring's front/back, so the
 * painter's-algorithm ordering fix from gridSlotTransforms /
 * sphericalTransforms still applies here.
 */
function bandsSlotTransforms(count: number, radius: number): DistributedTransform[] {
  // Latitudes in degrees, north to south; kept off the exact poles
  // (±90) since a ring's radius shrinks to 0 there anyway.
  const latitudes = [62, 31, 0, -31, -62]
  const bandRadii = latitudes.map((lat) => radius * Math.cos((lat * Math.PI) / 180))
  const totalCircumference = bandRadii.reduce((sum, r) => sum + r, 0)
  const counts = bandRadii.map((r) =>
    Math.max(3, Math.round((r / totalCircumference) * count)),
  )
  // Rounding can drift the total off `count` by a couple of slots —
  // correct it on the equator band (index 2), the least visually
  // sensitive place for a slightly different card count.
  const drift = count - counts.reduce((sum, c) => sum + c, 0)
  counts[2] = Math.max(3, counts[2]! + drift)

  const out: DistributedTransform[] = []
  latitudes.forEach((lat, bandIndex) => {
    const bandRadius = bandRadii[bandIndex]!
    const bandCount = counts[bandIndex]!
    const y = radius * Math.sin((lat * Math.PI) / 180)
    // Offset alternating bands by half a step so cards don't all line
    // up in vertical columns — reads as a woven ball rather than a
    // stack of separate hoops.
    const startAngle = bandIndex % 2 === 0 ? 0 : 180 / bandCount
    const step = 360 / bandCount
    for (let i = 0; i < bandCount; i++) {
      const angle = startAngle + step * i
      const rad = (angle * Math.PI) / 180
      out.push({
        x: bandRadius * Math.sin(rad),
        y,
        z: bandRadius * Math.cos(rad),
        rotation: 0,
        rotationX: 0,
        rotationY: angle,
      })
    }
  })
  out.sort((a, b) => b.z - a.z)
  return out
}

function slotTransformsFor(
  spec: PerspectiveTemplateSpec,
  params: PerspectiveTemplateParams,
): DistributedTransform[] {
  switch (spec.arrangement) {
    case 'ring':
      return distributeTransforms(
        { kind: 'ring', radius: params.radius, startAngle: 0, faceOutward: true },
        params.slotCount,
      )
    case 'bands':
      return bandsSlotTransforms(params.slotCount, params.radius)
    case 'grid':
      return gridSlotTransforms(
        params.slotCount,
        params.gridColumns,
        params.slotWidth,
        params.slotHeight,
        params.gridGap,
      )
  }
}

/** A container big enough to fit the arrangement, for a sane default hit-box/bounding size. */
export function containerSizeFor(spec: PerspectiveTemplateSpec, params: PerspectiveTemplateParams): number {
  if (spec.arrangement === 'grid') {
    const cols = Math.max(1, params.gridColumns)
    const rows = Math.ceil(params.slotCount / cols)
    return Math.max(
      cols * params.slotWidth + (cols - 1) * params.gridGap,
      rows * params.slotHeight + (rows - 1) * params.gridGap,
    )
  }
  return params.radius * 2 + Math.max(params.slotWidth, params.slotHeight)
}

/** Extracts just the PerspectiveTemplateParams fields from a spec (drops label/arrangement/animation/slotColor). */
function paramsFromSpec(spec: PerspectiveTemplateSpec): PerspectiveTemplateParams {
  const {
    kind, radius, slotWidth, slotHeight, slotCornerRadius, slotCount, spinDuration, gridColumns, gridGap,
  } = spec
  return { kind, radius, slotWidth, slotHeight, slotCornerRadius, slotCount, spinDuration, gridColumns, gridGap }
}

/**
 * (Re)writes the container's rotationY spin as a continuously-looping
 * turn — one keyframe every `spinDuration` seconds, each a further +360°
 * on top of the last (720, 1080, …) rather than wrapping back to 0. A
 * single 0→360 pair reads as "spins once, then stops" for the rest of
 * the scene, which doesn't match a template that's supposed to keep
 * turning. Ever-increasing values keep the motion smooth at each loop
 * point — REPLACE-semantics linear interpolation between them never has
 * to jump back to 0. Cycles run at least one full turn past the scene's
 * current duration so it never visibly stops while scrubbing or on
 * loop-playback, however long the scene runs; re-run this after any
 * spinDuration edit or scene-duration change to keep the coverage
 * current. No-ops (and removes any existing spin track) for templates
 * whose `animation` isn't 'spin-y'.
 */
function writeAnimationKeyframes(
  api: SceneAPI,
  containerId: NodeId,
  spec: PerspectiveTemplateSpec,
  startTime: number,
  spinDuration: number,
): void {
  const existing = api
    .getTracksForNode(containerId)
    .find((t) => t.propertyId === 'transform.rotationY')
  if (existing) api.deleteTrack(existing.id)
  if (spec.animation !== 'spin-y') return

  const sceneDuration = api.getMeta().duration
  const cycles = Math.max(
    1,
    Math.ceil((sceneDuration - startTime) / spinDuration) + 1,
  )
  for (let i = 0; i <= cycles; i++) {
    addKeyframe(api, containerId, 'transform.rotationY', startTime + i * spinDuration, i * 360)
  }
}

/**
 * Insert one Perspective template at `at`. Creates a `group3d` container
 * sized to fit the arrangement, `slotCount` empty image-drop frames laid
 * out per the template's `arrangement` (each its own `plane` so it tilts
 * independently), and — for templates with `animation: 'spin-y'` — a
 * rotationY track that spins the container continuously starting at
 * `startTime`.
 */
export function insertPerspectiveTemplate(
  api: SceneAPI,
  parentId: NodeId | null,
  kind: PerspectiveTemplateKind,
  at: { x: number; y: number },
  startTime = 0,
): NodeId {
  const spec = PERSPECTIVE_TEMPLATES[kind]
  const params = paramsFromSpec(spec)
  let containerId = ''
  api.doc.transact(() => {
    const size = containerSizeFor(spec, params)
    const name = uniqueNodeName(api, spec.label)
    containerId = api.createNode('frame', parentId, {
      name,
      position: 'absolute',
      size: { width: size, height: size },
      clipsContent: false,
      appearance: EMPTY_APPEARANCE,
      perspectiveTemplate: params,
      transform: {
        ...IDENTITY_TRANSFORM,
        x: at.x,
        y: at.y,
        rotationY: spec.arrangement === 'grid' ? GRID_DEFAULT_YAW : 0,
        renderMode: 'group3d',
      },
    })

    const transforms = slotTransformsFor(spec, params)
    const centerX = size / 2 - params.slotWidth / 2
    const centerY = size / 2 - params.slotHeight / 2
    transforms.forEach((t, i) => {
      api.createNode('frame', containerId, {
        name: `Slot ${i + 1}`,
        position: 'absolute',
        size: { width: params.slotWidth, height: params.slotHeight },
        clipsContent: true,
        appearance: emptySlotAppearance(spec, params.slotCornerRadius),
        transform: {
          ...IDENTITY_TRANSFORM,
          x: centerX + t.x,
          y: centerY + t.y,
          z: t.z,
          rotationX: t.rotationX,
          rotationY: t.rotationY,
          renderMode: 'plane',
        },
      })
    })

    writeAnimationKeyframes(api, containerId, spec, startTime, params.spinDuration)
  })
  return containerId
}

/**
 * Regenerate a Perspective template's arrangement from an edited copy of
 * its params — the "Radius" / "Card roundness" / etc. controls in the
 * Inspector call this on every change. Repositions every existing slot
 * (preserving whatever's inside it), adds slots if `slotCount` grew,
 * and removes only the trailing slots if it shrank. No-ops if
 * `containerId` isn't a Perspective template container.
 */
export function applyPerspectiveTemplateParams(
  api: SceneAPI,
  containerId: NodeId,
  params: PerspectiveTemplateParams,
): void {
  const container = api.getNode(containerId)
  if (!container || container.kind !== 'frame' || !container.perspectiveTemplate) return
  const spec = PERSPECTIVE_TEMPLATES[params.kind as PerspectiveTemplateKind]
  if (!spec) return

  api.doc.transact(() => {
    const size = containerSizeFor(spec, params)
    api.setNodeProperty(containerId, 'size', { width: size, height: size })
    api.setNodeProperty(containerId, 'perspectiveTemplate', params)

    const slots = api.getChildren(containerId)
    // Trim from the end first so the transforms computed below line up
    // 1:1 with whatever slots remain / get created.
    for (const slot of slots.slice(params.slotCount)) {
      api.deleteNode(slot.id)
    }
    const remaining: Node[] = slots.slice(0, params.slotCount)

    const transforms = slotTransformsFor(spec, params)
    const centerX = size / 2 - params.slotWidth / 2
    const centerY = size / 2 - params.slotHeight / 2

    transforms.forEach((t, i) => {
      const existing = remaining[i]
      const nextTransform = {
        ...IDENTITY_TRANSFORM,
        x: centerX + t.x,
        y: centerY + t.y,
        z: t.z,
        rotationX: t.rotationX,
        rotationY: t.rotationY,
        renderMode: 'plane' as const,
      }
      if (existing) {
        api.setNodeProperty(existing.id, 'size', {
          width: params.slotWidth,
          height: params.slotHeight,
        })
        api.setNodeProperty(existing.id, 'transform', nextTransform)
        if ('appearance' in existing) {
          api.setNodeProperty(existing.id, 'appearance', {
            ...existing.appearance,
            // Backfills a stroke on slots created before placeholder
            // strokes existed, without clobbering one the user set by
            // hand (only fills in when still null).
            stroke: existing.appearance.stroke ?? emptySlotAppearance(spec, params.slotCornerRadius).stroke,
            cornerRadius: params.slotCornerRadius,
          })
        }
        return
      }
      api.createNode('frame', containerId, {
        name: `Slot ${i + 1}`,
        position: 'absolute',
        size: { width: params.slotWidth, height: params.slotHeight },
        clipsContent: true,
        appearance: emptySlotAppearance(spec, params.slotCornerRadius),
        transform: nextTransform,
      })
    })

    // Preserve the original start time (when the animation was first
    // authored) rather than resetting it to 0 on every param edit.
    const existingSpin = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    const startTime = existingSpin?.keyframes[0]?.time ?? 0
    writeAnimationKeyframes(api, containerId, spec, startTime, params.spinDuration)
  })
}

/**
 * True if `nodeId` is a direct slot of some Perspective template — i.e.
 * its parent has `perspectiveTemplate` set. Used to stop the normal
 * click-to-select-and-drag interaction on a bare slot frame from
 * letting a user hand-move it out of its computed position; the
 * arrangement is meant to be edited as one asset via
 * `applyPerspectiveTemplateParams`, not per-slot. Dropping an image
 * onto a slot is unaffected — that's a different code path
 * (dropTargetFrame.ts) that doesn't go through this check.
 */
export function isPerspectiveTemplateSlot(
  api: SceneAPI,
  nodeId: NodeId,
): NodeId | null {
  const node = api.getNode(nodeId)
  if (!node || !node.parent) return null
  const parent = api.getNode(node.parent)
  if (!parent || parent.kind !== 'frame' || !parent.perspectiveTemplate) return null
  return parent.id
}
