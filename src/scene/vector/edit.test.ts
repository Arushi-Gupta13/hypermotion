// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  applyVectorFillColor,
  isEditableVectorNode,
  lerpVectorDocuments,
  moveVectorAnchor,
  moveVectorHandle,
  primaryVectorFillColor,
  vectorDocumentsCompatible,
} from './edit'
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
          geometry: new VectorPathBuilder('other').moveTo(0, 0).lineTo(1, 1).build(),
        }),
      ],
    }
    expect(lerpVectorDocuments(a, other, 0.25)).toBe(a)
    expect(lerpVectorDocuments(a, other, 1)).toBe(other)
  })

  it('rewrites the primary solid fill', () => {
    const vector = { version: 1 as const, items: [triangle()] }
    expect(primaryVectorFillColor(vector)).toBe('#ff5500')
    expect(primaryVectorFillColor(applyVectorFillColor(vector, '#00aa00'))).toBe(
      '#00aa00',
    )
  })
})
