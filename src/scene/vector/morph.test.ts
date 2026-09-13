// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createVectorItem, solidVectorPaint } from './model'
import { VectorPathBuilder } from './path'
import { lerpVectorDocuments, vectorDocumentsCompatible } from './edit'
import {
  applyMorphTarget,
  MorphPathError,
  parseMorphPathInput,
  remapVectorGeometry,
} from './morph'

function triangle() {
  return new VectorPathBuilder('tri')
    .moveTo(0, 0)
    .lineTo(100, 0)
    .lineTo(50, 80)
    .closePath()
    .build()
}

function square() {
  return new VectorPathBuilder('sq')
    .moveTo(0, 0)
    .lineTo(80, 0)
    .lineTo(80, 80)
    .lineTo(0, 80)
    .closePath()
    .build()
}

describe('morph path input', () => {
  it('parses d strings and mini SVG', () => {
    const fromD = parseMorphPathInput('M0 0 L100 0 L50 80 Z')
    expect(Object.keys(fromD.geometry.segments).length).toBeGreaterThan(0)
    expect(fromD.fills).toEqual([])
    const fromSvg = parseMorphPathInput(
      '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L5 8 Z"/></svg>',
    )
    expect(fromSvg.geometry.contours.length).toBeGreaterThan(0)
  })

  it('rejects empty or invalid path data', () => {
    expect(() => parseMorphPathInput('')).toThrow(MorphPathError)
    expect(() => parseMorphPathInput('<svg></svg>')).toThrow(MorphPathError)
    expect(() => parseMorphPathInput('M 0 0 L nope')).toThrow(MorphPathError)
  })

  it('captures a pasted SVG snippet\'s fill', () => {
    const parsed = parseMorphPathInput(
      '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L5 8 Z" fill="#ff00ff"/></svg>',
    )
    expect(parsed.fills).toHaveLength(1)
    expect(parsed.fills[0]).toMatchObject({ kind: 'solid', color: '#ff00ff' })
  })

  it('remaps unlike shapes onto shared ids so lerp interpolates', () => {
    const remapped = remapVectorGeometry(triangle(), square())
    expect(vectorDocumentsCompatible(
      { version: 1, items: [createVectorItem({ id: 'a', geometry: triangle() })] },
      { version: 1, items: [createVectorItem({ id: 'a', geometry: remapped })] },
    )).toBe(true)
    const from = {
      version: 1 as const,
      items: [
        createVectorItem({
          id: 'shape',
          geometry: triangle(),
          fills: [solidVectorPaint('#ff0000')],
        }),
      ],
    }
    const to = applyMorphTarget(from, square(), {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
    expect(vectorDocumentsCompatible(from, to)).toBe(true)
    // No target fill was passed, so the source's fill carries through untouched.
    expect(to.items[0]!.fills[0]).toMatchObject({ color: '#ff0000' })
    const mid = lerpVectorDocuments(from, to, 0.5)
    const id = Object.keys(from.items[0]!.geometry.points)[0]!
    const fx = from.items[0]!.geometry.points[id]!.x
    const tx = to.items[0]!.geometry.points[id]!.x
    expect(mid.items[0]!.geometry.points[id]!.x).toBeCloseTo((fx + tx) / 2)
  })

  it('carries the target fill when one is provided, and interpolates it', () => {
    const from = {
      version: 1 as const,
      items: [
        createVectorItem({
          id: 'shape',
          geometry: triangle(),
          fills: [solidVectorPaint('oklch(0.5 0.2 20)')],
        }),
      ],
    }
    const to = applyMorphTarget(
      from,
      square(),
      { x: 0, y: 0, width: 100, height: 80 },
      [solidVectorPaint('oklch(0.5 0.2 200)')],
    )
    expect(to.items[0]!.fills[0]).toMatchObject({ color: 'oklch(0.5 0.2 200)' })
    const mid = lerpVectorDocuments(from, to, 0.5)
    const midFill = mid.items[0]!.fills[0]
    expect(midFill?.kind).toBe('solid')
    // Halfway between hue 20 and hue 200 (shortest arc) lands at 110.
    expect(midFill?.kind === 'solid' ? midFill.color : '').toContain('110.00')
  })
})
