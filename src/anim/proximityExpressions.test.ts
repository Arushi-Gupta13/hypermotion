// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { getAnimEngine } from './engine'
import type { AnimatedValue } from './engine'

afterEach(() => getAnimEngine().pause())

describe('proximity expressions', () => {
  it('modulates target opacity based on distance to trigger', () => {
    const api = createSceneAPI()
    const root = api.getRoot()
    const trigger = api.createNode('rect', root, {
      transform: { x: 100, y: 100, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
    })
    const target = api.createNode('rect', root, {
      transform: { x: 100, y: 200, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
      proximityExpressions: [
        {
          id: 'prox-1',
          triggerNodeId: trigger,
          radius: 200,
          falloff: 'linear',
          effects: [{ propertyId: 'appearance.opacity', from: 0, to: -0.5 }],
          enabled: true,
        },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    const snap = engine.getSnapshot()
    const targetVal = snap[target]
    expect(targetVal).toBeDefined()
    // Distance is 100, radius is 200, so proximity = 0.5
    // Linear falloff: strength = 0.5
    // Effect delta = lerp(0, -0.5, 0.5) = -0.25
    // Default opacity is 1, so final = 1 + (-0.25) = 0.75
    expect(targetVal.opacity).toBeCloseTo(0.75, 2)
  })

  it('does not affect target when outside radius', () => {
    const api = createSceneAPI()
    const root = api.getRoot()
    const trigger = api.createNode('rect', root, {
      transform: { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
    })
    const target = api.createNode('rect', root, {
      transform: { x: 500, y: 500, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
      proximityExpressions: [
        {
          id: 'prox-2',
          triggerNodeId: trigger,
          radius: 100,
          falloff: 'linear',
          effects: [{ propertyId: 'appearance.opacity', from: 0, to: -1 }],
          enabled: true,
        },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    const snap = engine.getSnapshot()
    // Target is far outside radius, no proximity effect
    expect(snap[target]?.opacity).toBeUndefined()
  })

  it('respects enabled flag', () => {
    const api = createSceneAPI()
    const root = api.getRoot()
    const trigger = api.createNode('rect', root, {
      transform: { x: 100, y: 100, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
    })
    const target = api.createNode('rect', root, {
      transform: { x: 100, y: 150, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
      proximityExpressions: [
        {
          id: 'prox-3',
          triggerNodeId: trigger,
          radius: 200,
          falloff: 'linear',
          effects: [{ propertyId: 'appearance.opacity', from: 0, to: -1 }],
          enabled: false,
        },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    const snap = engine.getSnapshot()
    // Disabled — no proximity effect applied
    expect(snap[target]?.opacity).toBeUndefined()
  })

  it('applies ease-out falloff curve', () => {
    const api = createSceneAPI()
    const root = api.getRoot()
    const trigger = api.createNode('rect', root, {
      transform: { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
    })
    const target = api.createNode('rect', root, {
      transform: { x: 100, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
      proximityExpressions: [
        {
          id: 'prox-4',
          triggerNodeId: trigger,
          radius: 200,
          falloff: 'ease-out',
          effects: [{ propertyId: 'transform.scaleX', from: 0, to: 1 }],
          enabled: true,
        },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    const snap = engine.getSnapshot()
    // Distance=100, radius=200 → proximity=0.5
    // ease-out: 1 - (1-0.5)^2 = 1 - 0.25 = 0.75
    // delta = lerp(0, 1, 0.75) = 0.75
    // default scaleX=1, so final = 1+0.75 = 1.75
    expect(snap[target]?.scaleX).toBeCloseTo(1.75, 2)
  })

  it('modulates position based on animated trigger position', () => {
    const api = createSceneAPI()
    const root = api.getRoot()
    const trigger = api.createNode('rect', root, {
      transform: { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
    })
    const target = api.createNode('rect', root, {
      transform: { x: 0, y: 100, z: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0 },
      proximityExpressions: [
        {
          id: 'prox-5',
          triggerNodeId: trigger,
          radius: 200,
          falloff: 'linear',
          effects: [{ propertyId: 'transform.y', from: 0, to: -20 }],
          enabled: true,
        },
      ],
    })

    // Animate trigger to move away
    api.setTrack({
      id: 'track-trigger-x',
      nodeId: trigger,
      propertyId: 'transform.x',
      keyframes: [
        { id: 'kf0', time: 0, value: 0 },
        { id: 'kf1', time: 1, value: 400 },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)

    // At t=0, trigger at x=0, target at y=100 → dist=100 → proximity = 0.5
    engine.seek(0)
    const snap0 = engine.getSnapshot()
    expect(snap0[target]?.y).toBeDefined()

    // At t=1, trigger at x=400 → dist>200 → no effect
    engine.seek(1)
    const snap1 = engine.getSnapshot()
    // Distance = sqrt(400^2 + 100^2) ≈ 412 > 200, no proximity effect
    // When no proximity is applied and no y track exists, y is undefined in the snapshot
    expect(snap1[target]?.y).toBeUndefined()
  })
})
