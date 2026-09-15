// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { distributeTransforms } from './gridDistribution'

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

  it('returns an empty array for zero items', () => {
    expect(distributeTransforms({ kind: 'spherical', radius: 10 }, 0)).toEqual([])
  })
})
