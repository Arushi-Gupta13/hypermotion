// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_BEND_DEFORMATION } from '@/scene/deformation'
import {
  bendDeformationInTargetSpace,
  bendPoint,
  bendPointStack,
  resolveBendDeformation,
  resolveBendStackInTargetSpace,
} from './bendDeformation'

describe('bend deformation', () => {
  it('wraps the capture length around a predictable circular arc', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      captureLength: 100,
      resolvedLength: 100,
    }
    const endpoint = bendPoint({ x: 100, y: 0, z: 0 }, bend)
    expect(endpoint.x).toBeCloseTo(200 / Math.PI, 4)
    expect(endpoint.y).toBeCloseTo(0, 6)
    expect(endpoint.z).toBeCloseTo(200 / Math.PI, 4)
  })

  it('keeps geometry beyond a limited region on its endpoint tangent', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      captureLength: 100,
      resolvedLength: 100,
      limitToRegion: true,
    }
    const beyond = bendPoint({ x: 150, y: 0, z: 0 }, bend)
    expect(beyond.x).toBeCloseTo(200 / Math.PI, 4)
    expect(beyond.y).toBeCloseTo(0, 6)
    expect(beyond.z).toBeCloseTo(200 / Math.PI + 50, 4)
  })

  it('centers the capture range when both directions is enabled', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      bothDirections: true,
      captureLength: 100,
      resolvedLength: 100,
    }
    expect(bendPoint({ x: -50, y: 0, z: 0 }, bend)).toEqual({
      x: -50,
      y: 0,
      z: 0,
    })
  })

  it('blends continuously with the factor control', () => {
    const full = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      factor: 1,
      captureLength: 100,
      resolvedLength: 100,
    }
    const bent = bendPoint({ x: 100, y: 0, z: 0 }, full)
    const halfway = bendPoint(
      { x: 100, y: 0, z: 0 },
      { ...full, factor: 0.5 },
    )
    expect(halfway.x).toBeCloseTo((100 + bent.x) / 2, 5)
    expect(halfway.z).toBeCloseTo(bent.z / 2, 5)
  })

  it('resolves automatic length and live keyframe overrides', () => {
    const bend = resolveBendDeformation(
      DEFAULT_BEND_DEFORMATION,
      {
        bendAngle: -45,
        bendFactor: 0.4,
        bendCaptureLength: 240,
        bendLightAzimuth: 20,
        bendAmbient: 1.2,
        bendRoughness: 0.25,
      },
      320,
      180,
    )
    expect(bend).toMatchObject({
      angle: -45,
      factor: 0.4,
      captureLength: 240,
      resolvedLength: 240,
      lightAzimuth: 20,
      ambient: 1.2,
      roughness: 0.25,
    })
  })

  it('keeps an extracted child on the same continuous ancestor curve', () => {
    const sourceRect = { x: 100, y: 80, width: 400, height: 240 }
    const childRect = { x: 180, y: 120, width: 120, height: 64 }
    const sourceBend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 80,
      captureLength: 400,
      resolvedLength: 400,
      captureOrigin: { x: 12, y: -8, z: 0 },
    }
    const childBend = bendDeformationInTargetSpace(
      sourceBend,
      sourceRect,
      childRect,
    )
    const childPoint = { x: 35, y: 14, z: 0 }
    const childCenterOffset = {
      x:
        childRect.x + childRect.width / 2 -
        (sourceRect.x + sourceRect.width / 2),
      y:
        childRect.y + childRect.height / 2 -
        (sourceRect.y + sourceRect.height / 2),
      z: 0,
    }
    const sourcePoint = {
      x: childPoint.x + childCenterOffset.x,
      y: childPoint.y + childCenterOffset.y,
      z: 0,
    }
    const bentInSource = bendPoint(sourcePoint, sourceBend)
    const bentInChild = bendPoint(childPoint, childBend)

    expect(bentInChild.x + childCenterOffset.x).toBeCloseTo(
      bentInSource.x,
      5,
    )
    expect(bentInChild.y + childCenterOffset.y).toBeCloseTo(
      bentInSource.y,
      5,
    )
    expect(bentInChild.z).toBeCloseTo(bentInSource.z, 5)
  })

  it('applies a child Bend before carrying it through the parent Bend', () => {
    const parent = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 70,
      captureLength: 480,
      resolvedLength: 480,
    }
    const child = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: -35,
      captureLength: 240,
      resolvedLength: 240,
      captureDirection: { x: 0, y: 1, z: 0 },
    }
    const point = { x: 90, y: 30, z: 0 }

    const stacked = bendPointStack(point, [child, parent])
    const manuallyStacked = bendPoint(bendPoint(point, child), parent)

    expect(stacked.x).toBeCloseTo(manuallyStacked.x, 6)
    expect(stacked.y).toBeCloseTo(manuallyStacked.y, 6)
    expect(stacked.z).toBeCloseTo(manuallyStacked.z, 6)
    expect(stacked).not.toEqual(bendPoint(point, child))
    expect(stacked).not.toEqual(bendPoint(point, parent))
  })

  it('resolves nested animated Bend values in child-to-parent order', () => {
    const parentRect = { x: 100, y: 80, width: 480, height: 320 }
    const childRect = { x: 200, y: 140, width: 240, height: 160 }
    const stack = resolveBendStackInTargetSpace(
      [
        {
          deformation: DEFAULT_BEND_DEFORMATION,
          animated: { bendAngle: -70 },
          rect: parentRect,
        },
        {
          deformation: DEFAULT_BEND_DEFORMATION,
          animated: { bendAngle: 25 },
          rect: childRect,
        },
      ],
      childRect,
    )

    expect(stack.map((bend) => bend.angle)).toEqual([25, -70])
    expect(stack[0]?.captureOrigin).toEqual({ x: 0, y: 0, z: 0 })
    expect(stack[1]?.captureOrigin).toEqual({ x: 20, y: 20, z: 0 })
  })
})
