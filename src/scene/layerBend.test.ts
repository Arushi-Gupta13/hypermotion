// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_BEND,
  evaluateLayerBendInPlane,
  evaluateLayerBendZ,
  layerBendIsActive,
  mergeLayerBend,
} from './layerBend'

describe('layer bend field', () => {
  it('is inactive at defaults', () => {
    expect(layerBendIsActive(DEFAULT_LAYER_BEND)).toBe(false)
    expect(layerBendIsActive(mergeLayerBend(undefined, { tl: 40 }))).toBe(true)
  })

  it('samples corners bilinearly and adds edge bumps', () => {
    const corners = mergeLayerBend(undefined, { tl: 100, tr: 0, br: 0, bl: 0 })
    expect(evaluateLayerBendZ(0, 0, corners)).toBeCloseTo(100)
    expect(evaluateLayerBendZ(1, 0, corners)).toBeCloseTo(0)
    expect(evaluateLayerBendZ(0.5, 0, corners)).toBeCloseTo(50)

    const top = mergeLayerBend(undefined, { top: 80 })
    expect(evaluateLayerBendZ(0.5, 0, top)).toBeCloseTo(80)
    expect(evaluateLayerBendZ(0.5, 1, top)).toBeCloseTo(0)
  })

  it('tucks a lifted top-left corner toward the center in plane', () => {
    const z = 100
    const { dx, dy } = evaluateLayerBendInPlane(0, 0, z)
    expect(dx).toBeGreaterThan(0)
    expect(dy).toBeLessThan(0)
  })
})
