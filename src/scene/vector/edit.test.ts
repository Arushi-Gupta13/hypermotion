// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  applyVectorFill,
  isEditableVectorNode,
  lerpVectorDocuments,
  lerpVectorPaint,
  moveVectorAnchor,
  moveVectorHandle,
  primaryVectorFillColor,
  vectorDocumentsCompatible,
} from './edit'
import { lerpMorphedVectorDocuments } from './morph'
import { createVectorItem, solidVectorPaint } from './model'
import { VectorPathBuilder } from './path'
import type { VectorNode } from '@/scene/types'

function triangle() {
  return createVectorItem({
    id: 'logo-item',
    geometry: new VectorPathBuilder('logo')
      .moveTo(0, 0)
      .lineTo(100, 0)
      .lineTo(50, 80)
      .closePath()
      .build(),
    fills: [solidVectorPaint('#ff5500')],
  })
}

describe('vector edit helpers', () => {
  it('gates point editing to editable vectors', () => {
    const editable = {
      kind: 'vector',
      importFidelity: 'editable',
    } as VectorNode
    const preserved = {
      kind: 'vector',
      importFidelity: 'preserved',
    } as VectorNode
    expect(isEditableVectorNode(editable)).toBe(true)
    expect(isEditableVectorNode(preserved)).toBe(false)
    expect(isEditableVectorNode({ kind: 'rect' })).toBe(false)
  })

  it('moves an anchor and connected cubic handles together', () => {
    const vector = {
      version: 1 as const,
      items: [
        createVectorItem({
          id: 'curve',
          geometry: new VectorPathBuilder('curve')
            .moveTo(0, 0)
            .cubicTo(20, -20, 80, -20, 100, 0)
            .build(),
        }),
      ],
    }
    const start = Object.values(vector.items[0]!.geometry.points)[0]!
    const next = moveVectorAnchor(vector, 'curve', start.id, { x: 10, y: 5 })
    const moved = next.items[0]!.geometry.points[start.id]!
    expect(moved).toMatchObject({ x: 10, y: 5 })
    const segment = Object.values(next.items[0]!.geometry.segments)[0]!
    expect(segment.controlStart).toEqual({ x: 30, y: -15 })
  })

  it('mirrors the opposite cubic handle when handleMode is mirrored', () => {
    const geometry = new VectorPathBuilder('s')
      .moveTo(0, 50)
      .cubicTo(0, 0, 50, 0, 50, 50)
      .cubicTo(50, 100, 100, 100, 100, 50)
      .build()
    const mid = Object.values(geometry.points).find(
      (point) => point.x === 50 && point.y === 50,
    )!
    geometry.points[mid.id] = { ...mid, handleMode: 'mirrored' }
    const vector = {
      version: 1 as const,
      items: [createVectorItem({ id: 's', geometry })],
    }
    const firstSeg = Object.values(geometry.segments).find(
      (segment) => segment.endPointId === mid.id,
    )!
    const next = moveVectorHandle(
      vector,
      's',
      firstSeg.id,
      'end',
      { x: 50, y: 10 },
      'mirrored',
    )
    const second = Object.values(next.items[0]!.geometry.segments).find(
      (segment) => segment.startPointId === mid.id,
    )!
    expect(second.controlStart).toEqual({ x: 50, y: 90 })
  })

  it('lerps compatible path graphs and steps mismatched topology', () => {
    const a = { version: 1 as const, items: [triangle()] }
    const b = moveVectorAnchor(
      a,
      'logo-item',
      Object.values(a.items[0]!.geometry.points)[0]!.id,
      { x: 20, y: 0 },
    )
    expect(vectorDocumentsCompatible(a, b)).toBe(true)
    const mid = lerpVectorDocuments(a, b, 0.5)
    const pointId = Object.values(a.items[0]!.geometry.points)[0]!.id
    expect(mid.items[0]!.geometry.points[pointId]!.x).toBe(10)
    const other = {
      version: 1 as const,
      items: [
        createVectorItem({
          id: 'other',
          geometry: new VectorPathBuilder('other')
            .moveTo(40, 10)
            .lineTo(90, 10)
            .lineTo(90, 60)
            .lineTo(40, 60)
            .closePath()
            .build(),
        }),
      ],
    }
    expect(lerpVectorDocuments(a, other, 0.25)).toBe(a)
    expect(lerpVectorDocuments(a, other, 1)).toBe(other)
    const remappedMid = lerpMorphedVectorDocuments(a, other, 0.5)
    const pid = Object.values(a.items[0]!.geometry.points)[0]!.id
    expect(remappedMid.items[0]!.geometry.points[pid]!.x).not.toBe(
      a.items[0]!.geometry.points[pid]!.x,
    )
  })

  it('rewrites the primary fill (solid or gradient)', () => {
    const vector = { version: 1 as const, items: [triangle()] }
    expect(primaryVectorFillColor(vector)).toBe('#ff5500')
    expect(
      primaryVectorFillColor(applyVectorFill(vector, solidVectorPaint('#00aa00'))),
    ).toBe('#00aa00')
  })

  it('interpolates solid fills through OKLCH and steps mismatched kinds', () => {
    const from = solidVectorPaint('oklch(0.5 0.2 20)')
    const to = solidVectorPaint('oklch(0.5 0.2 200)')
    const mid = lerpVectorPaint(from, to, 0.5)
    expect(mid.kind).toBe('solid')
    expect(mid.kind === 'solid' ? mid.color : '').toContain('110.00')

    const gradient: import('@/scene/types').VectorPaint = {
      id: 'g', kind: 'linear', stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }],
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, visible: true, opacity: 1, blendMode: 'normal',
    }
    expect(lerpVectorPaint(from, gradient, 0.4)).toBe(from)
    expect(lerpVectorPaint(from, gradient, 1)).toBe(gradient)
  })
})
