// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { FrameNode } from '@/scene/types'
import {
  PERSPECTIVE_TEMPLATES,
  applyPerspectiveTemplateParams,
  insertPerspectiveTemplate,
  isPerspectiveTemplateSlot,
  type PerspectiveTemplateParams,
} from './perspectiveTemplates'

describe('insertPerspectiveTemplate', () => {
  it('creates a group3d container with one slot frame per spec.slotCount', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })

    const spec = PERSPECTIVE_TEMPLATES['card-tunnel']
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const container = api.getNode(containerId) as FrameNode

    expect(container.kind).toBe('frame')
    expect(container.position).toBe('absolute')
    expect(container.transform.renderMode).toBe('group3d')
    expect(container.perspectiveTemplate).toMatchObject({
      kind: 'card-tunnel',
      radius: spec.radius,
      slotCount: spec.slotCount,
    })

    const slots = api.getChildren(containerId)
    expect(slots).toHaveLength(spec.slotCount)
    for (const slot of slots) {
      expect(slot.kind).toBe('frame')
      expect((slot as FrameNode).clipsContent).toBe(true)
      expect(slot.transform.renderMode).toBe('plane')
    }
  })

  it('spaces the slots around a ring — no two slots share the same x/z', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)

    const positions = new Set(slots.map((s) => `${Math.round(s.transform.x)},${Math.round(s.transform.z)}`))
    expect(positions.size).toBe(slots.length)
  })

  it('adds a continuously-looping rotationY spin track, +360° every spinDuration, starting at the given playhead', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const spec = PERSPECTIVE_TEMPLATES['card-tunnel']

    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 }, 2.5)

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    // Every cycle is a further +360° (not wrapped back to 0), so the
    // spin never visibly stops or snaps — and it covers at least one
    // full cycle past the scene's duration, not just a single turn.
    expect(track!.keyframes.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < track!.keyframes.length; i++) {
      expect(track!.keyframes[i]).toMatchObject({
        time: 2.5 + i * spec.spinDuration,
        value: i * 360,
      })
    }
    const lastKeyframe = track!.keyframes[track!.keyframes.length - 1]!
    expect(lastKeyframe.time).toBeGreaterThanOrEqual(api.getMeta().duration)
  })

  it('gives repeated inserts increasing names instead of colliding', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })

    const first = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const second = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 400, y: 0 })

    expect(api.getNode(first)?.name).toBe('Card Tunnel')
    expect(api.getNode(second)?.name).toBe('Card Tunnel 2')
  })
})

describe('applyPerspectiveTemplateParams', () => {
  function currentParams(
    api: ReturnType<typeof createSceneAPI>,
    containerId: string,
  ): PerspectiveTemplateParams {
    return (api.getNode(containerId) as FrameNode).perspectiveTemplate!
  }

  it('repositions every slot when radius changes, without touching the container size math incorrectly', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const before = api.getChildren(containerId).map((s) => s.transform.x)

    const params = { ...currentParams(api, containerId), radius: 500 }
    applyPerspectiveTemplateParams(api, containerId, params)

    const after = api.getChildren(containerId).map((s) => s.transform.x)
    expect(after).not.toEqual(before)
    expect(currentParams(api, containerId).radius).toBe(500)
  })

  it('preserves a slot\'s existing children when regenerating (dropped media survives a param edit)', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const firstSlotId = api.getChildren(containerId)[0]!.id
    const imageId = api.createNode('image', firstSlotId, {
      name: 'Dropped photo',
      size: { width: 130, height: 170 },
      src: 'data:image/png;base64,',
    })

    applyPerspectiveTemplateParams(api, containerId, {
      ...currentParams(api, containerId),
      radius: 400,
      slotCornerRadius: 20,
    })

    // Same slot id, same child still attached, new roundness applied.
    expect(api.getChildren(containerId)[0]!.id).toBe(firstSlotId)
    expect(api.getChildren(firstSlotId).map((c) => c.id)).toEqual([imageId])
    expect(api.getNode(firstSlotId)?.appearance.cornerRadius).toBe(20)
  })

  it('adds new empty slots when slotCount increases, appended after the existing ones', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const originalIds = api.getChildren(containerId).map((s) => s.id)

    applyPerspectiveTemplateParams(api, containerId, {
      ...currentParams(api, containerId),
      slotCount: 10,
    })

    const slots = api.getChildren(containerId)
    expect(slots).toHaveLength(10)
    expect(slots.slice(0, originalIds.length).map((s) => s.id)).toEqual(originalIds)
  })

  it('removes only the trailing slots when slotCount decreases, deleting anything dropped inside them', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const originalSlots = api.getChildren(containerId)
    const keptIds = originalSlots.slice(0, 3).map((s) => s.id)
    const droppedSlotId = originalSlots[originalSlots.length - 1]!.id
    const orphanImageId = api.createNode('image', droppedSlotId, {
      size: { width: 10, height: 10 },
      src: 'data:image/png;base64,',
    })

    applyPerspectiveTemplateParams(api, containerId, {
      ...currentParams(api, containerId),
      slotCount: 3,
    })

    expect(api.getChildren(containerId).map((s) => s.id)).toEqual(keptIds)
    expect(api.getNode(droppedSlotId)).toBeNull()
    expect(api.getNode(orphanImageId)).toBeNull()
  })

  it('rewrites the spin cycle length (keeping its start time) when spinDuration changes', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 }, 1)

    applyPerspectiveTemplateParams(api, containerId, {
      ...currentParams(api, containerId),
      spinDuration: 4,
    })

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    expect(track!.keyframes[0]).toMatchObject({ time: 1, value: 0 })
    expect(track!.keyframes[1]).toMatchObject({ time: 5, value: 360 })
    // Still covers at least up to the scene's duration.
    const lastKeyframe = track!.keyframes[track!.keyframes.length - 1]!
    expect(lastKeyframe.time).toBeGreaterThanOrEqual(api.getMeta().duration)
  })

  it('is a no-op on a node that is not a Perspective template container', () => {
    const api = createSceneAPI()
    const plainFrameId = api.createNode('frame', null, { size: { width: 100, height: 100 } })
    const before = api.getNode(plainFrameId)

    applyPerspectiveTemplateParams(api, plainFrameId, {
      kind: 'card-tunnel',
      radius: 999,
      slotWidth: 1,
      slotHeight: 1,
      slotCornerRadius: 1,
      slotCount: 1,
      spinDuration: 1,
      gridColumns: 3,
      gridGap: 16,
    })

    expect(api.getNode(plainFrameId)).toEqual(before)
  })
})

describe('isPerspectiveTemplateSlot', () => {
  it('returns the container id for a direct slot of a template', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const slotId = api.getChildren(containerId)[0]!.id

    expect(isPerspectiveTemplateSlot(api, slotId)).toBe(containerId)
  })

  it('returns null for the container itself, for unrelated nodes, and for an image dropped inside a slot', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 })
    const slotId = api.getChildren(containerId)[0]!.id
    const imageId = api.createNode('image', slotId, {
      size: { width: 10, height: 10 },
      src: 'data:image/png;base64,',
    })
    const unrelatedId = api.createNode('rect', rootId, { size: { width: 10, height: 10 } })

    expect(isPerspectiveTemplateSlot(api, containerId)).toBeNull()
    expect(isPerspectiveTemplateSlot(api, unrelatedId)).toBeNull()
    // The image is a grandchild of the container (child of a slot), not
    // a direct slot itself — it should edit normally.
    expect(isPerspectiveTemplateSlot(api, imageId)).toBeNull()
  })
})

describe('orbit-globe (interior sphere patch, same concave geometry as sphere-wall)', () => {
  function localForward(rotationX: number, rotationY: number): [number, number, number] {
    const rx = (rotationX * Math.PI) / 180
    const ry = (rotationY * Math.PI) / 180
    const y1 = -Math.sin(rx)
    const z1 = Math.cos(rx)
    return [z1 * Math.sin(ry), y1, z1 * Math.cos(ry)]
  }

  it('places the container at the active camera position, not at the given 2D offset', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const camera = api.getActiveCamera()!
    const containerId = insertPerspectiveTemplate(api, rootId, 'orbit-globe', { x: 12345, y: -6789 })
    const container = api.getNode(containerId)!
    expect(container.transform.x).toBe(camera.transform.x)
    expect(container.transform.y).toBe(camera.transform.y)
    expect(container.transform.z).toBe(camera.transform.z)
  })

  it('lines every card up on a true rectangular grid — no two cards flattened into circles or scattered like orbiting dots', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const spec = PERSPECTIVE_TEMPLATES['orbit-globe']
    const cols = spec.gridColumns
    const rows = Math.ceil(spec.slotCount / cols)
    // 15 columns × 9 rows — odd × odd, so there's an exact center slot.
    expect(cols).toBe(15)
    expect(rows).toBe(9)

    const containerId = insertPerspectiveTemplate(api, rootId, 'orbit-globe', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)
    expect(slots).toHaveLength(spec.slotCount)

    // Rectangular cards, not circles: corner radius must stay well
    // short of half the slot size (the old bug rounded corners into a
    // full circle).
    expect(spec.slotCornerRadius).toBeLessThan(Math.min(spec.slotWidth, spec.slotHeight) / 2)

    for (const slot of slots) {
      expect((slot as FrameNode).size.width).toBe(spec.slotWidth)
      expect((slot as FrameNode).size.height).toBe(spec.slotHeight)
      // Every card sits on the sphere centered exactly on the camera —
      // position = normalize(direction) * radius — a real sphere, not
      // a flat grid or a radial/orbit scatter.
      const dist = Math.hypot(slot.transform.x, slot.transform.y, slot.transform.z)
      expect(dist).toBeCloseTo(spec.radius, 1)
    }

    // Distinct rows, and the same set of azimuth angles repeats in
    // every row — an aligned grid, not a scatter of points.
    const anglesByHeight = new Map<number, number[]>()
    for (const slot of slots) {
      const y = Math.round(slot.transform.y)
      const list = anglesByHeight.get(y) ?? []
      list.push(Math.round(slot.transform.rotationY))
      anglesByHeight.set(y, list)
    }
    expect(anglesByHeight.size).toBe(rows)
    const rowAngleSets = [...anglesByHeight.values()].map((list) => [...list].sort((a, b) => a - b))
    for (let i = 1; i < rowAngleSets.length; i++) {
      expect(rowAngleSets[i]).toEqual(rowAngleSets[0])
    }
    expect(rowAngleSets[0]!.length).toBe(cols)

    // An exact center slot exists at phi=0, theta=0 — dead ahead of
    // the camera on both axes, not merely close to it. (Its exact
    // rotation values are the ones that spin its default +Z-facing
    // pose 180° around to point back at the camera — verified
    // precisely by the normal-direction test below, not by a specific
    // rotationX/rotationY number here.)
    const centerSlot = slots.find(
      (s) => Math.round(s.transform.x) === 0 && Math.round(s.transform.y) === 0,
    )
    expect(centerSlot).toBeDefined()

    // The horizontal span (leftmost to rightmost column, center to
    // center) and vertical span land in the requested ranges.
    const azStepRad = (spec.slotWidth + spec.gridGap) / spec.radius
    const elStepRad = (spec.slotHeight + spec.gridGap) / spec.radius
    const horizontalSpanDeg = ((cols - 1) * azStepRad * 180) / Math.PI
    const verticalSpanDeg = ((rows - 1) * elStepRad * 180) / Math.PI
    expect(horizontalSpanDeg).toBeGreaterThanOrEqual(100)
    expect(horizontalSpanDeg).toBeLessThanOrEqual(120)
    expect(verticalSpanDeg).toBeGreaterThanOrEqual(60)
    expect(verticalSpanDeg).toBeLessThanOrEqual(75)
  })

  it("orients every card's face exactly at normalize(cameraPosition - cardPosition) — every card faces the camera, not all the same direction", () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'orbit-globe', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)

    const rotations = new Set<string>()
    for (const slot of slots) {
      const { x, y, z, rotationX, rotationY } = slot.transform
      // Camera sits at this local space's origin, so
      // normalize(cameraPosition - cardPosition) is just normalize(-position).
      const dist = Math.hypot(x, y, z) || 1
      const towardCamera = [-x / dist, -y / dist, -z / dist]
      const forward = localForward(rotationX, rotationY)
      const dot =
        forward[0] * towardCamera[0] + forward[1] * towardCamera[1] + forward[2] * towardCamera[2]
      expect(dot).toBeCloseTo(1, 5)
      rotations.add(`${Math.round(rotationX)},${Math.round(rotationY)}`)
    }
    // Cards progressively rotate toward the sides/top/bottom by
    // spherical position — not all facing the same fixed direction.
    expect(rotations.size).toBeGreaterThan(1)
  })

  it('sways the container back and forth instead of fully spinning', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'orbit-globe', { x: 0, y: 0 }, 2)

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    expect(track).toBeDefined()
    expect(track!.keyframes[0]).toMatchObject({ time: 2, value: 0 })
    // A full spin would rotate this bounded patch away from the camera
    // and expose bare space where there's no "back" — sway keeps it
    // facing roughly forward instead.
    for (const kf of track!.keyframes) {
      expect(Math.abs(kf.value as number)).toBeLessThanOrEqual(15)
    }
    const lastKeyframe = track!.keyframes[track!.keyframes.length - 1]!
    expect(lastKeyframe.time).toBeGreaterThanOrEqual(api.getMeta().duration)
  })
})

describe('totem-wall (grid arrangement, no spin)', () => {
  it('lays out slots in a grid, one z-depth per column, painted back-to-front', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const spec = PERSPECTIVE_TEMPLATES['totem-wall']
    const rows = Math.ceil(spec.slotCount / spec.gridColumns)

    const containerId = insertPerspectiveTemplate(api, rootId, 'totem-wall', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)
    expect(slots).toHaveLength(spec.slotCount)

    // Exactly one distinct z per column — a "totem" depth stagger, not
    // a flat wall — and each column has a distinct x.
    const depths = new Set(slots.map((s) => Math.round(s.transform.z)))
    expect(depths.size).toBe(spec.gridColumns)
    const xsByDepth = new Set(
      slots.map((s) => `${Math.round(s.transform.z)}:${Math.round(s.transform.x)}`),
    )
    expect(new Set([...xsByDepth].map((k) => Number(k.split(':')[0])))).toEqual(depths)

    // Slots are returned sorted back-to-front (largest z first) so the
    // no-z-buffer renderer paints nearer columns on top — see
    // gridSlotTransforms' doc comment.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.transform.z).toBeLessThanOrEqual(slots[i - 1]!.transform.z)
    }

    // Each z-group (one column) has `rows` slots, all sharing that z
    // but spread across distinct y positions.
    const firstDepthGroup = slots.filter(
      (s) => Math.round(s.transform.z) === Math.round(slots[0]!.transform.z),
    )
    expect(firstDepthGroup).toHaveLength(rows)
    expect(new Set(firstDepthGroup.map((s) => Math.round(s.transform.y))).size).toBe(rows)
  })

  it('bakes in a starting yaw on the container so the depth stagger actually foreshortens', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'totem-wall', { x: 0, y: 0 })
    expect(api.getNode(containerId)?.transform.rotationY).not.toBe(0)
  })

  it('has no rotationY spin track — a static wall', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'totem-wall', { x: 0, y: 0 })

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    expect(track).toBeUndefined()
  })

  it('re-flows into the new column count when gridColumns changes, preserving dropped media', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'totem-wall', { x: 0, y: 0 })
    const firstSlotId = api.getChildren(containerId)[0]!.id
    const imageId = api.createNode('image', firstSlotId, {
      size: { width: 10, height: 10 },
      src: 'data:image/png;base64,',
    })
    const params = (api.getNode(containerId) as FrameNode).perspectiveTemplate!

    applyPerspectiveTemplateParams(api, containerId, { ...params, gridColumns: 5 })

    expect(api.getChildren(containerId)[0]!.id).toBe(firstSlotId)
    expect(api.getChildren(firstSlotId).map((c) => c.id)).toEqual([imageId])
    const depths = new Set(
      api.getChildren(containerId).map((s) => Math.round(s.transform.z)),
    )
    expect(depths.size).toBe(5)
  })
})

describe('sphere-wall (interior sphere patch — camera near, not exactly at, the shell center)', () => {
  /** Same rotateX-then-rotateY convention the renderer uses (see gridDistribution.ts's ringTransforms/scene3d.ts) — rotates local +Z by rotationX then rotationY. */
  function localForward(rotationX: number, rotationY: number): [number, number, number] {
    const rx = (rotationX * Math.PI) / 180
    const ry = (rotationY * Math.PI) / 180
    // rotateX around local X: (0,0,1) -> (0, -sin(rx), cos(rx))
    const y1 = -Math.sin(rx)
    const z1 = Math.cos(rx)
    // rotateY around Y: (0, y1, z1) -> (z1*sin(ry), y1, z1*cos(ry))
    return [z1 * Math.sin(ry), y1, z1 * Math.cos(ry)]
  }

  it('places the container at the active camera position, not at the given 2D offset', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const camera = api.getActiveCamera()!
    const containerId = insertPerspectiveTemplate(api, rootId, 'sphere-wall', { x: 12345, y: -6789 })
    const container = api.getNode(containerId)!
    expect(container.transform.x).toBe(camera.transform.x)
    expect(container.transform.y).toBe(camera.transform.y)
    expect(container.transform.z).toBe(camera.transform.z)
  })

  it('lines every tile up on the same shell, radius away from the camera-centered origin', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const spec = PERSPECTIVE_TEMPLATES['sphere-wall']
    const cols = spec.gridColumns
    const rows = Math.ceil(spec.slotCount / cols)

    const containerId = insertPerspectiveTemplate(api, rootId, 'sphere-wall', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)
    expect(slots).toHaveLength(spec.slotCount)

    for (const slot of slots) {
      expect((slot as FrameNode).size.width).toBe(spec.slotWidth)
      expect((slot as FrameNode).size.height).toBe(spec.slotHeight)
      expect(slot.transform.scaleX).toBe(1)
      expect(slot.transform.scaleY).toBe(1)
      expect(slot.transform.rotation).toBe(0)
      // Interior slot positions are already camera-relative — no
      // container-box centering offset applied to them, and the
      // sphere's center IS the camera-relative origin: position =
      // normalize(direction) * radius, so every tile sits exactly
      // `radius` away from that origin.
      const dist = Math.hypot(slot.transform.x, slot.transform.y, slot.transform.z)
      expect(dist).toBeCloseTo(spec.radius, 1)
    }

    // Distinct rows.
    const heights = new Set(slots.map((s) => Math.round(s.transform.y)))
    expect(heights.size).toBe(rows)

    // Columns line up across rows: the same set of rotationY angles
    // repeats in every row — an aligned grid, not a scatter.
    const anglesByHeight = new Map<number, number[]>()
    for (const slot of slots) {
      const y = Math.round(slot.transform.y)
      const list = anglesByHeight.get(y) ?? []
      list.push(Math.round(slot.transform.rotationY))
      anglesByHeight.set(y, list)
    }
    expect(anglesByHeight.size).toBe(rows)
    const rowAngleSets = [...anglesByHeight.values()].map((list) => [...list].sort((a, b) => a - b))
    for (let i = 1; i < rowAngleSets.length; i++) {
      expect(rowAngleSets[i]).toEqual(rowAngleSets[0])
    }
    expect(rowAngleSets[0]!.length).toBe(cols)
  })

  it("orients every tile's face exactly at normalize(cameraPosition - tilePosition) — a true inward-facing shell", () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'sphere-wall', { x: 0, y: 0 })
    const slots = api.getChildren(containerId)

    for (const slot of slots) {
      const { x, y, z, rotationX, rotationY } = slot.transform
      // Camera sits at this local space's origin, so
      // normalize(cameraPosition - tilePosition) is just normalize(-position).
      const dist = Math.hypot(x, y, z) || 1
      const towardCamera = [-x / dist, -y / dist, -z / dist]
      const forward = localForward(rotationX, rotationY)
      const dot =
        forward[0] * towardCamera[0] + forward[1] * towardCamera[1] + forward[2] * towardCamera[2]
      expect(dot).toBeCloseTo(1, 5)
    }
  })

  it('sways the container back and forth instead of fully spinning', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'sphere-wall', { x: 0, y: 0 }, 2)

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    expect(track).toBeDefined()
    expect(track!.keyframes[0]).toMatchObject({ time: 2, value: 0 })
    // Every value stays within a small bound — never accumulates toward
    // 360 like a full spin would.
    for (const kf of track!.keyframes) {
      expect(Math.abs(kf.value as number)).toBeLessThanOrEqual(15)
    }
    // Covers well past the scene duration so it never visibly stops.
    const lastKeyframe = track!.keyframes[track!.keyframes.length - 1]!
    expect(lastKeyframe.time).toBeGreaterThanOrEqual(api.getMeta().duration)
  })

  it('does not yaw the container at rest — the sway itself supplies the motion', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })
    const containerId = insertPerspectiveTemplate(api, rootId, 'sphere-wall', { x: 0, y: 0 })
    expect(api.getNode(containerId)?.transform.rotationY).toBe(0)
  })
})

describe('spin coverage', () => {
  it('keeps spinning across a scene far longer than one spinDuration cycle, never holding still', () => {
    const api = createSceneAPI()
    api.setMeta({ duration: 120 })
    const rootId = api.createNode('frame', null, { size: { width: 1920, height: 1080 } })

    const containerId = insertPerspectiveTemplate(api, rootId, 'card-tunnel', { x: 0, y: 0 }, 0)

    const track = api
      .getTracksForNode(containerId)
      .find((t) => t.propertyId === 'transform.rotationY')
    // A single 0->360 pair (the old "spin once" design) would leave the
    // ring motionless for the last 110s of a 120s scene. There must be
    // enough cycles to keep turning the whole way through.
    expect(track!.keyframes.length).toBeGreaterThan(2)
    const lastKeyframe = track!.keyframes[track!.keyframes.length - 1]!
    expect(lastKeyframe.time).toBeGreaterThanOrEqual(120)
    // Values keep climbing rather than wrapping back to 0 at each loop —
    // no jump for the interpolator to snap across.
    for (let i = 1; i < track!.keyframes.length; i++) {
      expect(track!.keyframes[i]!.value as number).toBeGreaterThan(
        track!.keyframes[i - 1]!.value as number,
      )
    }
  })
})
