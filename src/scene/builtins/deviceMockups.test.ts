// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { FrameNode, VectorNode } from '@/scene/types'
import {
  DEVICE_MOCKUP_SPECS,
  insertDeviceMockup,
  isDeviceMockupRoot,
  rescaleDeviceMockupChildren,
} from './deviceMockups'

describe('device mockup builtins', () => {
  it('builds an iPhone mockup front-to-back: island, then Screen, then Bezel underneath', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })

    const spec = DEVICE_MOCKUP_SPECS.iphone17pro
    const outerId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 10, y: 20 })
    const outer = api.getNode(outerId) as FrameNode
    expect(outer.kind).toBe('frame')
    // Free-transform, not flow-governed — a frame left at the 'flow' default
    // would have its size decided by the parent's auto-layout (if any)
    // instead of the resize handles.
    expect(outer.position).toBe('absolute')
    expect(outer.size).toEqual({ width: spec.width, height: spec.height })
    expect(outer.transform.x).toBe(10)
    expect(outer.transform.y).toBe(20)

    // Child index 0 is frontmost in this app's paint order (see
    // layerCompositing.ts). The island must paint over the screen, and the
    // screen over the bezel body — the reverse order (bezel first/frontmost)
    // is what made the whole mockup render as one opaque near-black
    // rectangle, hiding the screen, the chrome, and any dropped-in content.
    const children = api.getChildren(outerId)
    expect(children.map((c) => c.name)).toEqual(['Dynamic Island', 'Screen', 'Bezel'])

    const bezel = children[2] as VectorNode
    expect(bezel.kind).toBe('vector')
    // The body fill is a subtle gradient sheen (not a flat color) for a
    // more physical, less "rounded rectangle" read — its stops bracket
    // the spec's base bezelColor rather than equaling it directly.
    const bodyFill = bezel.vector.items[0]?.fills[0]
    expect(bodyFill?.kind).toBe('linear')
    expect(bodyFill && 'stops' in bodyFill ? bodyFill.stops.map((s) => s.color) : []).toContain(
      spec.bezelColor,
    )

    const screen = children[1] as FrameNode
    expect(screen.kind).toBe('frame')
    expect(screen.clipsContent).toBe(true)
    expect(screen.size).toEqual({
      width: spec.screen.width,
      height: spec.screen.height,
    })
    expect(screen.transform.x).toBe(spec.screen.x)
    expect(screen.transform.y).toBe(spec.screen.y)

    // A layer dropped inside the screen can carry its own 3D depth/rotation
    // independently — ordinary transform properties, nothing mockup-specific.
    const childId = api.createNode('rect', screen.id, {
      name: 'Inside content',
      size: { width: 100, height: 100 },
      transform: {
        x: 0, y: 0, z: 40, rotation: 0, rotationX: 10, rotationY: 5,
        scaleX: 1, scaleY: 1,
      },
    })
    const child = api.getNode(childId)!
    expect(child.transform.z).toBe(40)
    expect(child.transform.rotationX).toBe(10)
  })

  it('builds an iPhone 13 mockup with a classic flush notch, not an island', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const outerId = insertDeviceMockup(api, rootId, 'iphone13', { x: 0, y: 0 })
    const children = api.getChildren(outerId)
    expect(children.map((c) => c.name)).toEqual(['Notch', 'Screen', 'Bezel'])
  })

  it('builds an iPhone SE mockup with a home button and no top chrome', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const outerId = insertDeviceMockup(api, rootId, 'iphonese', { x: 0, y: 0 })
    const children = api.getChildren(outerId)
    // No island/notch child — the SE has neither. Screen is frontmost so
    // content is visible; the Bezel (with the home button drawn into it)
    // sits behind.
    expect(children.map((c) => c.name)).toEqual(['Screen', 'Bezel'])
    const bezel = children[1] as VectorNode
    expect(bezel.vector.items.some((item) => item.id === 'home-button')).toBe(true)
  })

  it('builds a Samsung Galaxy mockup with a centered punch-hole camera', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const outerId = insertDeviceMockup(api, rootId, 'galaxys24ultra', { x: 0, y: 0 })
    const children = api.getChildren(outerId)
    expect(children.map((c) => c.name)).toEqual(['Punch Hole', 'Screen', 'Bezel'])
    const punchHole = children[0] as VectorNode
    expect(punchHole.vector.items[0]?.id).toBe('punch-hole')
  })

  it('gives a flat-vector-only mockup (no real 3D body) an ambient drop shadow so it reads as sitting above the canvas', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    // Samsung/Browser kinds have no `glbUrl` and aren't iPhone-family, so
    // they never get a real 3D body — the faked shadow is the only depth
    // cue they have.
    const outerId = insertDeviceMockup(api, rootId, 'galaxys24', { x: 0, y: 0 })
    const outer = api.getNode(outerId) as FrameNode
    expect(outer.appearance.effects).toHaveLength(1)
    expect(outer.appearance.effects[0]).toMatchObject({ kind: 'shadow', visible: true })
  })

  it('skips the faked ambient shadow for a mockup that gets a real 3D body — a visible effect on a frame with children would force the whole subtree to rasterize as one flat texture, hiding the Bezel plane the real body substitution needs', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    for (const kind of ['iphone13', 'iphone17promax'] as const) {
      const outerId = insertDeviceMockup(api, rootId, kind, { x: 0, y: 0 })
      const outer = api.getNode(outerId) as FrameNode
      expect(outer.appearance.effects).toHaveLength(0)
      expect(outer.transform.renderMode).toBe('group3d')
    }
  })

  it('uses iPhone SE\'s real 375×667 UIKit point resolution for the screen', () => {
    expect(DEVICE_MOCKUP_SPECS.iphonese.screen.width).toBe(375)
    expect(DEVICE_MOCKUP_SPECS.iphonese.screen.height).toBe(667)
  })

  it('gives each iPhone model a distinct screen size', () => {
    const widths = new Set(
      (['iphone17promax', 'iphone17pro', 'iphone13', 'iphonese'] as const).map(
        (kind) => `${DEVICE_MOCKUP_SPECS[kind].width}x${DEVICE_MOCKUP_SPECS[kind].height}`,
      ),
    )
    expect(widths.size).toBe(4)
  })

  it('builds a browser mockup with three toolbar dots, Screen frontmost', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const outerId = insertDeviceMockup(api, rootId, 'browser', { x: 0, y: 0 })
    const children = api.getChildren(outerId)
    expect(children.map((c) => c.name)).toEqual(['Screen', 'Bezel'])
    const bezel = children[1] as VectorNode
    // body + 3 dots
    expect(bezel.vector.items).toHaveLength(4)
  })

  it('each insertion is independent — editing one bezel does not affect another', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const firstId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 0, y: 0 })
    const secondId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 400, y: 0 })
    const firstChildren = api.getChildren(firstId)
    const firstBezel = firstChildren[firstChildren.length - 1] as VectorNode
    const firstFill = firstBezel.vector.items[0]!.fills[0]!
    expect(firstFill.kind).toBe('linear')
    api.setNodeProperty(firstBezel.id, 'vector', {
      ...firstBezel.vector,
      items: [
        {
          ...firstBezel.vector.items[0]!,
          fills: [{ ...firstFill, kind: 'solid' as const, color: '#ff0000' }],
        },
      ],
    })
    const secondChildren = api.getChildren(secondId)
    const secondBezel = secondChildren[secondChildren.length - 1] as VectorNode
    const secondFill = secondBezel.vector.items[0]?.fills[0]
    expect(secondFill?.kind).toBe('linear')
    expect(
      secondFill && 'stops' in secondFill ? secondFill.stops.map((s) => s.color) : [],
    ).toContain(DEVICE_MOCKUP_SPECS.iphone17pro.bezelColor)
  })

  it('auto-numbers a second mockup of the same kind', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const firstId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 0, y: 0 })
    const secondId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 500, y: 0 })
    const thirdId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 1000, y: 0 })
    expect(api.getNode(firstId)?.name).toBe('iPhone 17 Pro Mockup')
    expect(api.getNode(secondId)?.name).toBe('iPhone 17 Pro Mockup 2')
    expect(api.getNode(thirdId)?.name).toBe('iPhone 17 Pro Mockup 3')
  })

  it('recognizes a mockup root by its Bezel/Screen children, and not an unrelated frame', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const outerId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 0, y: 0 })
    expect(isDeviceMockupRoot(api, outerId)).toBe(true)

    const plainId = api.createNode('frame', rootId, {
      name: 'Just a group',
      size: { width: 200, height: 200 },
    })
    api.createNode('rect', plainId, { name: 'Bezel', size: { width: 50, height: 50 } })
    // Named 'Bezel' but wrong kind, and no 'Screen' sibling — not a match.
    expect(isDeviceMockupRoot(api, plainId)).toBe(false)
  })

  it('resizing the mockup frame proportionally rescales its children (the actual drag-corner fix)', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const spec = DEVICE_MOCKUP_SPECS.iphone17pro
    const outerId = insertDeviceMockup(api, rootId, 'iphone17pro', { x: 0, y: 0 })
    const before = Object.fromEntries(
      api.getChildren(outerId).map((c) => [c.name, { x: c.transform.x, y: c.transform.y, size: 'size' in c ? c.size : null }]),
    )

    // Simulate dragging the SE corner to exactly double the frame.
    const newWidth = spec.width * 2
    const newHeight = spec.height * 2
    rescaleDeviceMockupChildren(api, outerId, spec.width, spec.height, newWidth, newHeight)

    for (const child of api.getChildren(outerId)) {
      const was = before[child.name]!
      expect(child.transform.x).toBeCloseTo(was.x * 2)
      expect(child.transform.y).toBeCloseTo(was.y * 2)
      if (was.size && 'size' in child) {
        expect(child.size.width).toBeCloseTo((was.size.width as number) * 2)
        expect(child.size.height).toBeCloseTo((was.size.height as number) * 2)
      }
    }

    // A vector child's viewBox is deliberately left alone — the box/viewBox
    // mismatch is what makes the renderer stretch its geometry for free.
    const bezel = api.getChildren(outerId).find((c) => c.name === 'Bezel') as VectorNode
    expect(bezel.viewBox).toEqual({ x: 0, y: 0, width: spec.width, height: spec.height })
    expect(bezel.size).toEqual({ width: spec.width * 2, height: spec.height * 2 })
  })

  it('rescale is a no-op when the size did not actually change', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 1920, height: 1080 },
    })
    const spec = DEVICE_MOCKUP_SPECS.browser
    const outerId = insertDeviceMockup(api, rootId, 'browser', { x: 0, y: 0 })
    const before = api.getChildren(outerId).map((c) => ({ ...c.transform }))
    rescaleDeviceMockupChildren(api, outerId, spec.width, spec.height, spec.width, spec.height)
    const after = api.getChildren(outerId).map((c) => ({ ...c.transform }))
    expect(after).toEqual(before)
  })
})
