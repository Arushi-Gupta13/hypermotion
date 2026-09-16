// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  ANIM_PRESET_CATEGORY_LABELS,
  PRESETS,
  applyPreset,
  planLayerPresetTargets,
  planTextPresetTargets,
  planTextStaggerStartTimes,
} from './presets'

describe('animation presets', () => {
  it('authors Fade In as an ease-out appearance opacity track', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)

    applyPreset(api, nodeId, 'fade-in', 1.25)

    const track = api
      .getTracksForNode(nodeId)
      .find((candidate) => candidate.propertyId === 'appearance.opacity')

    expect(track?.keyframes).toEqual([
      expect.objectContaining({
        time: 1.25,
        value: 0,
        easingOut: 'ease-out',
        presetOrigin: 'in',
      }),
      expect.objectContaining({
        time: 1.65,
        value: 1,
        presetOrigin: 'in',
      }),
    ])
  })

  it('keeps a selected container as the preset target when stagger is armed', () => {
    const plan = planLayerPresetTargets(
      ['container'],
      true,
      0.1,
      null,
    )

    expect(plan).toEqual({
      targets: ['container'],
      staggerActive: false,
      delay: 0.1,
      order: 'forward',
    })
  })

  it('uses only the saved members while editing an existing stagger set', () => {
    const plan = planLayerPresetTargets(
      ['source-layer'],
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['card-3', 'card-2', 'card-1'],
        delay: 0.25,
        order: 'reverse',
        members: {},
      },
    )

    expect(plan).toEqual({
      targets: ['card-3', 'card-2', 'card-1'],
      staggerActive: true,
      delay: 0.25,
      order: 'reverse',
    })
  })

  it('uses the active S relationship for text presets while preserving mixed-layer order', () => {
    const textIds = new Set(['title', 'caption'])
    const plan = planTextPresetTargets(
      ['title'],
      (id) => textIds.has(id),
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['title', 'image', 'caption'],
        delay: 0.2,
        order: 'reverse',
        members: {},
      },
    )

    expect(plan).toEqual({
      targets: ['title', 'caption'],
      staggerLayerIds: ['title', 'image', 'caption'],
      staggerActive: true,
      delay: 0.2,
      order: 'reverse',
    })
  })

  it('aligns freshly adopted text tracks to the full mixed-layer S order', () => {
    const plan = planTextPresetTargets(
      ['title'],
      (id) => id === 'title' || id === 'caption',
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['title', 'image', 'caption'],
        delay: 0.2,
        order: 'reverse',
        members: {},
      },
    )

    expect(planTextStaggerStartTimes(plan, 'title', 1)).toEqual({
      title: 1,
      caption: 0.6,
    })
  })

  it('animates Isometric In toward a fixed tilt rather than the node base rotation', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)

    applyPreset(api, nodeId, 'isometric-in', 0)

    const rotX = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.rotationX')
    const rotY = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.rotationY')

    expect(rotX?.keyframes.map((k) => k.value)).toEqual([0, 35])
    expect(rotY?.keyframes.map((k) => k.value)).toEqual([0, 45])
  })

  it('scatters two different nodes to two different offsets, deterministically', () => {
    const api = createSceneAPI()
    const a = api.createNode('rect', null)
    const b = api.createNode('rect', null)

    applyPreset(api, a, 'scatter-in', 0)
    applyPreset(api, b, 'scatter-in', 0)

    const startX = (id: string) =>
      api
        .getTracksForNode(id)
        .find((t) => t.propertyId === 'transform.x')?.keyframes[0]?.value

    const aStart = startX(a)
    const bStart = startX(b)
    expect(aStart).not.toBeUndefined()
    expect(aStart).not.toEqual(bStart)

    // Re-applying is deterministic for the same node.
    applyPreset(api, a, 'scatter-in', 0)
    expect(startX(a)).toEqual(aStart)
  })

  it('does not author child tracks when Fade In targets a container', () => {
    const api = createSceneAPI()
    const parentId = api.createNode('frame', null)
    const childId = api.createNode('rect', parentId)

    applyPreset(api, parentId, 'fade-in', 0)

    expect(api.getTracksForNode(parentId)).toHaveLength(1)
    expect(api.getTracksForNode(childId)).toHaveLength(0)
  })

  it('authors Flow In as a 3-stop arced path, not a straight 2-stop slide', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)

    applyPreset(api, nodeId, 'flow-in', 0)

    const xTrack = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.x')
    const rotTrack = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.rotation')
    expect(xTrack?.keyframes).toHaveLength(3)
    expect(rotTrack?.keyframes).toHaveLength(3)
    // The path curves rather than moving monotonically toward 0.
    const xs = xTrack!.keyframes.map((k) => k.value as number)
    expect(xs[0]).toBeLessThan(xs[1]!)
    expect(xs[1]).toBeLessThan(xs[2]!)
  })

  it('authors Wipe In as a left-anchored scaleX reveal with opacity untouched', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)

    applyPreset(api, nodeId, 'wipe-in-left', 0)

    expect(api.getNode(nodeId)?.transform.anchorX).toBe(0)
    const scaleTrack = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.scaleX')
    expect(scaleTrack?.keyframes.map((k) => k.value)).toEqual([0, 1])
    expect(
      api.getTracksForNode(nodeId).some((t) => t.propertyId === 'appearance.opacity'),
    ).toBe(false)
  })

  it('authors Flip In 3D as a rotationY-only turn (no rotationX tilt)', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)

    applyPreset(api, nodeId, 'flip-in-3d', 0)

    const rotY = api
      .getTracksForNode(nodeId)
      .find((t) => t.propertyId === 'transform.rotationY')
    expect(rotY?.keyframes.map((k) => k.value)).toEqual([180, 0])
    expect(
      api.getTracksForNode(nodeId).some((t) => t.propertyId === 'transform.rotationX'),
    ).toBe(false)
  })

  it('gives every preset a category with a real label, and every showcase category both an In and Out entry', () => {
    for (const preset of PRESETS) {
      expect(ANIM_PRESET_CATEGORY_LABELS[preset.category]).toBeTruthy()
    }
    const showcaseCategories = new Set(
      PRESETS.filter((p) => p.category !== 'basic').map((p) => p.category),
    )
    for (const category of showcaseCategories) {
      const inCount = PRESETS.filter(
        (p) => p.category === category && p.direction === 'in',
      ).length
      const outCount = PRESETS.filter(
        (p) => p.category === category && p.direction === 'out',
      ).length
      expect(inCount).toBeGreaterThan(0)
      expect(outCount).toBeGreaterThan(0)
    }
  })
})
