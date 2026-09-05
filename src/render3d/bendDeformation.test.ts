// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_BEND_DEFORMATION } from '@/scene/deformation'
import { bendPoint, resolveBendDeformation } from './bendDeformation'

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
})
