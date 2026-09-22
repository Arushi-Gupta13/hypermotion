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

export type PerspectiveTemplateKind = 'card-tunnel' | 'orbit-globe' | 'totem-wall' | 'sphere-wall'

/** How slots are laid out in space. Fixed per template kind. */
export type PerspectiveArrangement = 'ring' | 'grid' | 'sphere-interior'

/** What (if anything) the container keyframes on. Fixed per template kind. */
export type PerspectiveAnimation = 'spin-y' | 'sway-y' | 'none'

export interface PerspectiveTemplateParams {
  // Widened to `string` (not `PerspectiveTemplateKind`) so this type
  // round-trips through FrameNode['perspectiveTemplate'] without a
  // cast — that field is deliberately plain-string-typed for the same
  // layering reason as `deviceMockupKind` (see its doc comment).
  kind: string
  /** Distance from the ring/sphere/cylinder's center, in canvas pixels. Unused by grid arrangement. */
  radius: number
  slotWidth: number
  slotHeight: number
  slotCornerRadius: number
  slotCount: number
  /** Seconds for one full spin cycle. Unused when animation is 'none'. */
  spinDuration: number
  /** Columns per row. Meaningful for grid and cylinder arrangement. */
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
    // Same concave, camera-centered "inside a hollow shell" geometry as
    // sphere-wall (see sphereInteriorSlotTransforms) — a denser,
    // smaller-card patch of the same huge inner sphere, not a
    // different geometric system. Previously this was a set of
    // external latitude rings (bandsSlotTransforms) with a corner
    // radius exactly half the slot size, which rendered as circular
    // dots orbiting a distant ball instead of a wall of rectangular
    // cards — the "floating dots, not a card wall" bug.
    // slotCornerRadius below is deliberately far short of half of
    // slotWidth/slotHeight so cards read as rounded rectangles, not
    // circles.
    //
    // 15 columns × 9 rows (slotCount 135) is deliberately odd × odd —
    // gives an exact center slot at phi=0, theta=0 that faces the
    // camera perfectly straight-on, rather than splitting the center
    // between two neighboring slots. radius 440 with this slot
    // size/gap makes each angular step ((44+16)/440 ≈ 7.8°) work out
    // to roughly a 109° horizontal span (14 steps) by 62.5° vertical
    // span (8 steps) — "a large central patch," not a full globe.
    arrangement: 'sphere-interior',
    animation: 'sway-y',
    slotCount: 135,
    slotWidth: 44,
    slotHeight: 44,
    radius: 440,
    slotColor: '#2a2a32',
    slotStrokeColor: '#55555f',
    slotCornerRadius: 8,
    spinDuration: 16,
    gridColumns: 15,
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
  'sphere-wall': {
    kind: 'sphere-wall',
    label: 'Sphere Wall',
    arrangement: 'sphere-interior',
    animation: 'sway-y',
    // Cards line the INSIDE of a hollow sphere centered exactly on the
    // camera, all facing inward toward that same point (see
    // sphereInteriorSlotTransforms). The container itself is placed at
    // the active camera's own position (see
    // insertPerspectiveTemplate's `cameraPos` handling), not a 2D
    // canvas offset like every other template — so the container's own
    // local origin IS both the camera position and the sphere's
    // center. The curvature that reads as "standing inside a hollow
    // shell of cards" comes from real perspective projection (a fixed
    // angular size maps to a growing pixel size the further it sits
    // from the camera's forward axis), not from any position fudge.
    // The container sways gently (writeSwayKeyframes) rather than
    // fully spinning.
    slotCount: 160,
    slotWidth: 70,
    slotHeight: 54,
    radius: 800,
    slotColor: '#1c1c1e',
    slotStrokeColor: '#3f3f46',
    slotCornerRadius: 4,
    spinDuration: 20,
    gridColumns: 16,
    gridGap: 10,
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
 * Cards lining the INSIDE of a hollow sphere centered EXACTLY on the
 * camera (the container's own local origin — see
 * `insertPerspectiveTemplate`'s `cameraPos` handling, which places this
 * template's container at the active camera's own world position). For
 * every card, `position = sphereCenter + normalize(direction) * radius`
 * where `direction` comes from real spherical coordinates — azimuth
 * (`col` → longitude, left/right) and elevation (`row` → latitude,
 * up/down) turned into a unit vector via sin/cos, not a flat x/y grid
 * with a sagitta bent over it. Bounded to a patch of that sphere, NOT a
 * full enclosing shell — the angular span (see azStepRad/elStepRad
 * below) only covers as much of the sphere as this template's
 * slotCount/gridColumns actually need.
 *
 * Each card's rotation makes its own local +Z axis equal
 * `normalize(cameraPosition - cardPosition)` — since the camera sits
 * at this local space's origin, that's just `normalize(-position)`,
 * i.e. `-direction`. That means every card is exactly the same
 * distance (`radius`) from the camera and exactly perpendicular to the
 * camera ray that hits it — by itself, that sounds like it would
 * produce zero foreshortening (and it does: no card's own shape is
 * skewed by its position). The visible curvature instead comes from
 * the perspective projection's radial stretch: a flat rectilinear
 * camera maps a fixed angular size to a LARGER pixel size the further
 * that angle sits from the camera's own forward axis (screen = f *
 * tan(angle), not linear in angle) — so identically-sized, identically
 * face-on cards still grow and skew (width grows ∝ 1/cos²(azimuth),
 * height ∝ 1/cos(azimuth) off the horizontal axis alone) as they move
 * toward the edges of the patch. That's real 3D perspective math doing
 * the work, not a faked 2D distortion — it's the same effect that
 * makes a wide-FOV rectilinear photo stretch things near its edges.
 */
function sphereInteriorSlotTransforms(
  count: number,
  columns: number,
  radius: number,
  slotWidth: number,
  slotHeight: number,
  gap: number,
): DistributedTransform[] {
  const cols = Math.max(1, columns)
  const rows = Math.ceil(count / cols)
  // Arc-length spacing: the angular step per neighbor is chosen so
  // radius * step ≈ slotWidth/slotHeight + gap, keeping physical card
  // spacing on the shell consistent regardless of how tight or wide
  // the radius is.
  const azStepRad = radius > 0 ? (slotWidth + gap) / radius : 0
  const elStepRad = radius > 0 ? (slotHeight + gap) / radius : 0
  const out: DistributedTransform[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const phi = (col - (cols - 1) / 2) * azStepRad
    const theta = ((rows - 1) / 2 - row) * elStepRad
    const px = Math.sin(phi) * Math.cos(theta)
    const py = Math.sin(theta)
    const pz = Math.cos(phi) * Math.cos(theta)
    // Rotation that points this card's local +Z at -( px, py, pz ) —
    // i.e. exactly back at the camera, which sits at this local
    // space's origin. Depends only on the unit direction, matching
    // `normalize(cameraPosition - cardPosition)` exactly since
    // cardPosition = radius * (px, py, pz) and cameraPosition = 0.
    const rotationX = (Math.asin(py) * 180) / Math.PI
    const rotationY = (Math.atan2(-px, -pz) * 180) / Math.PI
    out.push({
      x: radius * px,
      y: radius * py,
      z: radius * pz,
      rotation: 0,
      rotationX,
      rotationY,
    })
  }
  // Every card is equidistant from the camera by construction (see
  // doc comment) — this sort is cosmetic but kept for a well-defined,
  // deterministic paint order in the no-z-buffer renderer.
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
    case 'grid':
      return gridSlotTransforms(
        params.slotCount,
        params.gridColumns,
        params.slotWidth,
        params.slotHeight,
        params.gridGap,
      )
    case 'sphere-interior':
      return sphereInteriorSlotTransforms(
        params.slotCount,
        params.gridColumns,
        params.radius,
        params.slotWidth,
        params.slotHeight,
        params.gridGap,
      )
  }
}

/** A container big enough to fit the arrangement, for a sane default hit-box/bounding size. */
export function containerSizeFor(spec: PerspectiveTemplateSpec, params: PerspectiveTemplateParams): number {
  if (spec.arrangement === 'grid') {
    // Lays slots out on a literal evenly-spaced x/y grid (see
    // gridSlotTransforms) — sizing off `radius` wouldn't apply here at
    // all (grid arrangement doesn't use it).
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
 * current.
 */
function writeSpinKeyframes(
  api: SceneAPI,
  containerId: NodeId,
  startTime: number,
  spinDuration: number,
): void {
  const sceneDuration = api.getMeta().duration
  const cycles = Math.max(
    1,
    Math.ceil((sceneDuration - startTime) / spinDuration) + 1,
  )
  for (let i = 0; i <= cycles; i++) {
    addKeyframe(api, containerId, 'transform.rotationY', startTime + i * spinDuration, i * 360)
  }
}

/** Degrees the container sways to either side of center for `animation: 'sway-y'`. */
const SWAY_AMPLITUDE = 6

/**
 * Writes a continuous, seamless back-and-forth sway on the container's
 * rotationY — 0 → +amplitude → 0 → -amplitude → 0 → … — rather than an
 * ever-increasing spin. A bounded sphere patch (see
 * sphereInteriorSlotTransforms) only has cards on its front face; a full
 * spin would rotate that face away from the camera for most of every
 * cycle and expose bare empty space where the (nonexistent) back would
 * be. Swaying within a modest amplitude keeps the grid's front
 * perpetually facing roughly toward the camera — "the entire wall
 * rotates slowly" without ever turning far enough to show anything but
 * the wall.
 */
function writeSwayKeyframes(
  api: SceneAPI,
  containerId: NodeId,
  startTime: number,
  period: number,
): void {
  const sceneDuration = api.getMeta().duration
  const quarterBeats = Math.max(
    4,
    (Math.ceil((sceneDuration - startTime) / period) + 1) * 4,
  )
  const quarterPeriod = period / 4
  const pattern = [0, SWAY_AMPLITUDE, 0, -SWAY_AMPLITUDE]
  for (let i = 0; i <= quarterBeats; i++) {
    addKeyframe(api, containerId, 'transform.rotationY', startTime + i * quarterPeriod, pattern[i % 4]!)
  }
}

/**
 * Dispatches to the right animation writer for `spec.animation`. Always
 * clears any existing rotationY track first (even for a template whose
 * `animation` doesn't use it, in case its `kind` ever changes what it
 * animates), then rewrites the one this template actually uses; a
 * no-op for `'none'`.
 */
function writeAnimationKeyframes(
  api: SceneAPI,
  containerId: NodeId,
  spec: PerspectiveTemplateSpec,
  startTime: number,
  spinDuration: number,
): void {
  const existingSpin = api
    .getTracksForNode(containerId)
    .find((t) => t.propertyId === 'transform.rotationY')
  if (existingSpin) api.deleteTrack(existingSpin.id)

  if (spec.animation === 'spin-y') {
    writeSpinKeyframes(api, containerId, startTime, spinDuration)
  } else if (spec.animation === 'sway-y') {
    writeSwayKeyframes(api, containerId, startTime, spinDuration)
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
    // A `sphere-interior` container's local origin is BOTH the camera
    // position and the sphere's own center — every slot position is
    // already expressed relative to it (see
    // sphereInteriorSlotTransforms) — so unlike every other template,
    // it's placed at the active camera's own position instead of `at`
    // (a 2D canvas offset, meaningless for "sit where the camera
    // sits"). Falls back to the origin if there's no active camera.
    const cameraPos =
      spec.arrangement === 'sphere-interior' ? api.getActiveCamera()?.transform : null
    containerId = api.createNode('frame', parentId, {
      name,
      position: 'absolute',
      size: { width: size, height: size },
      clipsContent: false,
      appearance: EMPTY_APPEARANCE,
      perspectiveTemplate: params,
      transform: {
        ...IDENTITY_TRANSFORM,
        x: cameraPos ? cameraPos.x : at.x,
        y: cameraPos ? cameraPos.y : at.y,
        z: cameraPos ? cameraPos.z : 0,
        rotationY: spec.arrangement === 'grid' ? GRID_DEFAULT_YAW : 0,
        renderMode: 'group3d',
      },
    })

    const transforms = slotTransformsFor(spec, params)
    // sphere-interior slots are already camera-relative (centered on
    // the container's own origin) — centering them again by the
    // container's declared box size would shift them off-camera.
    const centerX = spec.arrangement === 'sphere-interior' ? 0 : size / 2 - params.slotWidth / 2
    const centerY = spec.arrangement === 'sphere-interior' ? 0 : size / 2 - params.slotHeight / 2
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
          rotation: t.rotation,
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

    // Preserve the original start time (when the animation was first
    // authored) rather than resetting it to 0 on every param edit.
    const existingSpin = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    const startTime = existingSpin?.keyframes[0]?.time ?? 0

    const transforms = slotTransformsFor(spec, params)
    const centerX = spec.arrangement === 'sphere-interior' ? 0 : size / 2 - params.slotWidth / 2
    const centerY = spec.arrangement === 'sphere-interior' ? 0 : size / 2 - params.slotHeight / 2

    transforms.forEach((t, i) => {
      const existing = remaining[i]
      const nextTransform = {
        ...IDENTITY_TRANSFORM,
        x: centerX + t.x,
        y: centerY + t.y,
        z: t.z,
        rotation: t.rotation,
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
