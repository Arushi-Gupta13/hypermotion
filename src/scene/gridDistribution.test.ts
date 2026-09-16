// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { applyGridDistribution, distributeTransforms } from './gridDistribution'

describe('distributeTransforms', () => {
  it('spaces a full-sweep radial ring evenly with no seam', () => {
    const points = distributeTransforms(
      { kind: 'radial', radius: 100, startAngle: 0, sweep: 360, faceOutward: false },
      4,
    )
    expect(points).toHaveLength(4)
    // 0deg (up), 90deg (right), 180deg (down), 270deg (left).
    expect(points[0]!.x).toBeCloseTo(0)
    expect(points[0]!.y).toBeCloseTo(-100)
    expect(points[1]!.x).toBeCloseTo(100)
    expect(points[1]!.y).toBeCloseTo(0)
    expect(points[2]!.x).toBeCloseTo(0)
    expect(points[2]!.y).toBeCloseTo(100)
    expect(points[3]!.x).toBeCloseTo(-100)
    expect(points[3]!.y).toBeCloseTo(0)
  })

  it('spans a partial sweep across both endpoints inclusively', () => {
    const points = distributeTransforms(
      { kind: 'radial', radius: 50, startAngle: 0, sweep: 90, faceOutward: false },
      2,
    )
    expect(points[0]!.x).toBeCloseTo(0)
    expect(points[0]!.y).toBeCloseTo(-50)
    expect(points[1]!.x).toBeCloseTo(50)
    expect(points[1]!.y).toBeCloseTo(0)
  })

  it('rotates radial items outward when faceOutward is set', () => {
    const points = distributeTransforms(
      { kind: 'radial', radius: 100, startAngle: 45, sweep: 360, faceOutward: true },
      1,
    )
    expect(points[0]!.rotation).toBeCloseTo(45)
  })

  it('places path items at the endpoints and midpoint for a straight line', () => {
    const points = distributeTransforms(
      { kind: 'path', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, curve: 0, followTangent: false },
      3,
    )
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[1]!.x).toBeCloseTo(50)
    expect(points[1]!.y).toBeCloseTo(0)
    expect(points[2]!.x).toBeCloseTo(100)
    expect(points[2]!.y).toBeCloseTo(0)
  })

  it('bows a curved path off the straight line at the midpoint', () => {
    const points = distributeTransforms(
      { kind: 'path', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, curve: 40, followTangent: false },
      3,
    )
    // Midpoint of a quadratic bezier sits at half the control offset.
    expect(points[1]!.y).toBeCloseTo(20)
  })

  it('distributes spherical points within the sphere radius', () => {
    const points = distributeTransforms({ kind: 'spherical', radius: 10 }, 20)
    expect(points).toHaveLength(20)
    for (const p of points) {
      const dist = Math.hypot(p.x, p.y, p.z)
      expect(dist).toBeCloseTo(10, 5)
    }
  })

  it('spaces a ring evenly in the XZ plane, all at the same height', () => {
    const points = distributeTransforms(
      { kind: 'ring', radius: 100, startAngle: 0, faceOutward: false },
      4,
    )
    expect(points).toHaveLength(4)
    // 0deg: +Z (toward viewer). 90deg/180/270 sweep around Y.
    expect(points[0]).toMatchObject({ x: 0, z: 100, y: 0 })
    expect(points[1]!.x).toBeCloseTo(100)
    expect(points[1]!.z).toBeCloseTo(0)
    expect(points[2]!.x).toBeCloseTo(0)
    expect(points[2]!.z).toBeCloseTo(-100)
    expect(points[3]!.x).toBeCloseTo(-100)
    expect(points[3]!.z).toBeCloseTo(0)
    for (const p of points) {
      expect(p.y).toBe(0)
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(100)
    }
  })

  it('rotates ring items to face outward around Y when faceOutward is set', () => {
    const points = distributeTransforms(
      { kind: 'ring', radius: 100, startAngle: 45, faceOutward: true },
      1,
    )
    expect(points[0]!.rotationY).toBeCloseTo(45)
    expect(points[0]!.rotation).toBe(0)
    expect(points[0]!.rotationX).toBe(0)
  })

  it('returns an empty array for zero items', () => {
    expect(distributeTransforms({ kind: 'spherical', radius: 10 }, 0)).toEqual([])
  })
})

describe('applyGridDistribution', () => {
  it('centers differently-sized nodes on the ring instead of their top-left corner', () => {
    const api = createSceneAPI()
    // A small and a large node, both starting at the same corner — if the
    // arrange math anchored on transform.x/y (top-left) instead of each
    // node's own visual center, the large node would end up visibly
    // off-ring relative to the small one.
    const small = api.createNode('rect', null)
    api.setNodeProperty(small, 'size', { width: 20, height: 20 })
    const large = api.createNode('rect', null)
    api.setNodeProperty(large, 'size', { width: 200, height: 200 })

    applyGridDistribution(
      api,
      [small, large],
      { kind: 'radial', radius: 300, startAngle: 0, sweep: 180, faceOutward: false },
    )

    const centerOf = (id: string) => {
      const node = api.getNode(id)!
      const size = 'size' in node ? node.size : { width: 0, height: 0 }
      const width = typeof size.width === 'number' ? size.width : 0
      const height = typeof size.height === 'number' ? size.height : 0
      return { x: node.transform.x + width / 2, y: node.transform.y + height / 2 }
    }

    const smallCenter = centerOf(small)
    const largeCenter = centerOf(large)
    // Both points sit on a 300px-radius ring around their shared centroid,
    // regardless of each node's own box size.
    const centroid = {
      x: (smallCenter.x + largeCenter.x) / 2,
      y: (smallCenter.y + largeCenter.y) / 2,
    }
    expect(Math.hypot(smallCenter.x - centroid.x, smallCenter.y - centroid.y)).toBeCloseTo(300)
    expect(Math.hypot(largeCenter.x - centroid.x, largeCenter.y - centroid.y)).toBeCloseTo(300)
  })

  it('rapid successive calls (one per slider-drag tick) merge into a single undo step', () => {
    // The Inspector's Arrange panel calls applyGridDistribution on every
    // param tweak, including every tick of a live slider drag. If this
    // function tagged its transaction UNDOABLE_GESTURE_ORIGIN, each tick
    // would forcibly become its own separate, non-mergeable undo entry
    // (see useKeyboardShortcuts.ts and Y.UndoManager.stopCapturing) — a
    // two-second drag would need dozens of Undo clicks to fully revert.
    // Using the default origin lets Yjs's own 500ms captureTimeout
    // coalesce them into one, matching every other drag gesture in the
    // app.
    const api = createSceneAPI()
    const scene = api.doc.getMap('scene')
    const nodesMap = scene.get('nodes') as Y.Map<unknown>
    const mgr = new Y.UndoManager([nodesMap as unknown as Y.AbstractType<unknown>, scene as unknown as Y.AbstractType<unknown>], {
      captureTimeout: 500,
      trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
    })
    // Node creation itself lands on the undo stack too (correctly merged
    // with the second createNode call, since both happen in the same
    // tick) — reset the clock and snapshot the stack depth *after*
    // that, so the assertion below isolates just the drag-tick calls.
    const a = api.createNode('rect', null)
    const b = api.createNode('rect', null)
    mgr.lastChange = 0
    const stackDepthBeforeDrag = mgr.undoStack.length

    for (let i = 0; i < 10; i++) {
      applyGridDistribution(
        api,
        [a, b],
        { kind: 'radial', radius: 100 + i, startAngle: 0, sweep: 360, faceOutward: false },
      )
    }

    expect(mgr.undoStack.length).toBe(stackDepthBeforeDrag + 1)
  })
})
