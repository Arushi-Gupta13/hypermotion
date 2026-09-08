// SPDX-License-Identifier: Apache-2.0

import type {
  VectorDocument,
  VectorGeometry,
  VectorHandleMode,
  VectorItem,
  VectorNode,
  VectorPoint,
  VectorPosition,
  VectorSegment,
} from '@/scene/types'
import { emptyVectorDocument } from './model'

export function isEditableVectorNode(
  node: { kind: string } | null | undefined,
): node is VectorNode {
  return (
    !!node &&
    node.kind === 'vector' &&
    (node as VectorNode).importFidelity === 'editable'
  )
}

export function cloneVectorDocument(
  vector: VectorDocument | undefined | null,
): VectorDocument {
  if (!vector) return emptyVectorDocument()
  return structuredClone(vector)
}

export function primaryVectorFillColor(
  vector: VectorDocument | undefined | null,
): string | null {
  const fill = vector?.items[0]?.fills.find(
    (paint) => paint.visible && paint.kind === 'solid',
  )
  return fill && fill.kind === 'solid' ? fill.color : null
}

export function applyVectorFillColor(
  vector: VectorDocument,
  color: string,
): VectorDocument {
  const next = cloneVectorDocument(vector)
  const item = next.items[0]
  if (!item) return next
  const index = item.fills.findIndex(
    (paint) => paint.visible && paint.kind === 'solid',
  )
  if (index >= 0) {
    const fill = item.fills[index]
    if (fill?.kind === 'solid') item.fills[index] = { ...fill, color }
    return next
  }
  item.fills = [
    {
      id: 'fill-1',
      kind: 'solid',
      color,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    },
    ...item.fills,
  ]
  return next
}

export type VectorEditPart =
  | { kind: 'anchor'; itemId: string; pointId: string }
  | {
      kind: 'handle'
      itemId: string
      segmentId: string
      which: 'start' | 'end'
    }

export function vectorViewBoxToLocal(
  viewBox: VectorNode['viewBox'],
  size: { width: number; height: number },
  point: VectorPosition,
): VectorPosition {
  return {
    x:
      ((point.x - viewBox.x) / Math.max(0.0001, viewBox.width)) * size.width,
    y:
      ((point.y - viewBox.y) / Math.max(0.0001, viewBox.height)) *
      size.height,
  }
}

export function vectorLocalToViewBox(
  viewBox: VectorNode['viewBox'],
  size: { width: number; height: number },
  local: VectorPosition,
): VectorPosition {
  return {
    x:
      viewBox.x +
      (local.x / Math.max(0.0001, size.width)) * viewBox.width,
    y:
      viewBox.y +
      (local.y / Math.max(0.0001, size.height)) * viewBox.height,
  }
}

export function moveVectorAnchor(
  vector: VectorDocument,
  itemId: string,
  pointId: string,
  next: VectorPosition,
): VectorDocument {
  const nextDoc = cloneVectorDocument(vector)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return nextDoc
  const point = item.geometry.points[pointId]
  if (!point) return nextDoc
  const dx = next.x - point.x
  const dy = next.y - point.y
  item.geometry.points[pointId] = { ...point, x: next.x, y: next.y }
  for (const segment of Object.values(item.geometry.segments)) {
    if (segment.startPointId === pointId && segment.controlStart) {
      segment.controlStart = {
        x: segment.controlStart.x + dx,
        y: segment.controlStart.y + dy,
      }
    }
    if (segment.endPointId === pointId && segment.controlEnd) {
      segment.controlEnd = {
        x: segment.controlEnd.x + dx,
        y: segment.controlEnd.y + dy,
      }
    }
  }
  return nextDoc
}

export function moveVectorHandle(
  vector: VectorDocument,
  itemId: string,
  segmentId: string,
  which: 'start' | 'end',
  next: VectorPosition,
  handleMode: VectorHandleMode = 'independent',
): VectorDocument {
  const nextDoc = cloneVectorDocument(vector)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return nextDoc
  const segment = item.geometry.segments[segmentId]
  if (!segment) return nextDoc
  ensureCubicSegment(item.geometry, segment)
  if (which === 'start') segment.controlStart = { ...next }
  else segment.controlEnd = { ...next }

  const anchorId = which === 'start' ? segment.startPointId : segment.endPointId
  const anchor = item.geometry.points[anchorId]
  if (!anchor || handleMode === 'independent') return nextDoc

  const opposite = findOppositeHandle(item, segmentId, anchorId, which)
  if (!opposite) return nextDoc
  const oppositeSegment = item.geometry.segments[opposite.segmentId]
  if (!oppositeSegment) return nextDoc
  ensureCubicSegment(item.geometry, oppositeSegment)
  const incoming = which === 'start' ? next : next
  const vx = incoming.x - anchor.x
  const vy = incoming.y - anchor.y
  const length = Math.hypot(vx, vy)
  if (length < 1e-6) return nextDoc

  const oppositeControl =
    opposite.which === 'start'
      ? oppositeSegment.controlStart
      : oppositeSegment.controlEnd
  if (!oppositeControl) return nextDoc
  const oppositeLength =
    handleMode === 'mirrored'
      ? length
      : Math.hypot(oppositeControl.x - anchor.x, oppositeControl.y - anchor.y)
  const ox = anchor.x - (vx / length) * oppositeLength
  const oy = anchor.y - (vy / length) * oppositeLength
  if (opposite.which === 'start') {
    oppositeSegment.controlStart = { x: ox, y: oy }
  } else {
    oppositeSegment.controlEnd = { x: ox, y: oy }
  }
  return nextDoc
}

function ensureCubicSegment(
  geometry: VectorGeometry,
  segment: VectorSegment,
): void {
  const start = geometry.points[segment.startPointId]
  const end = geometry.points[segment.endPointId]
  if (!start || !end) return
  if (segment.kind !== 'cubic') {
    segment.kind = 'cubic'
    segment.controlStart = lerpPoint(start, end, 1 / 3)
    segment.controlEnd = lerpPoint(start, end, 2 / 3)
  } else {
    segment.controlStart ??= lerpPoint(start, end, 1 / 3)
    segment.controlEnd ??= lerpPoint(start, end, 2 / 3)
  }
}

function findOppositeHandle(
  item: VectorItem,
  segmentId: string,
  anchorId: string,
  which: 'start' | 'end',
): { segmentId: string; which: 'start' | 'end' } | null {
  for (const [id, segment] of Object.entries(item.geometry.segments)) {
    if (id === segmentId) continue
    if (segment.endPointId === anchorId) {
      return { segmentId: id, which: 'end' }
    }
    if (segment.startPointId === anchorId) {
      return { segmentId: id, which: 'start' }
    }
  }
  if (which === 'start' && item.geometry.segments[segmentId]?.endPointId === anchorId) {
    return { segmentId, which: 'end' }
  }
  if (which === 'end' && item.geometry.segments[segmentId]?.startPointId === anchorId) {
    return { segmentId, which: 'start' }
  }
  return null
}

function lerpPoint(
  a: VectorPoint,
  b: VectorPoint,
  t: number,
): VectorPosition {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

export function vectorDocumentsCompatible(
  a: VectorDocument,
  b: VectorDocument,
): boolean {
  if (a.items.length !== b.items.length) return false
  for (let i = 0; i < a.items.length; i++) {
    const left = a.items[i]!
    const right = b.items[i]!
    if (left.id !== right.id) return false
    const leftPoints = Object.keys(left.geometry.points)
    const rightPoints = Object.keys(right.geometry.points)
    if (leftPoints.length !== rightPoints.length) return false
    for (const id of leftPoints) {
      if (!right.geometry.points[id]) return false
    }
    const leftSegments = Object.keys(left.geometry.segments)
    const rightSegments = Object.keys(right.geometry.segments)
    if (leftSegments.length !== rightSegments.length) return false
    for (const id of leftSegments) {
      const ls = left.geometry.segments[id]
      const rs = right.geometry.segments[id]
      if (!ls || !rs) return false
      if (
        ls.startPointId !== rs.startPointId ||
        ls.endPointId !== rs.endPointId
      ) {
        return false
      }
    }
  }
  return true
}

export function lerpVectorDocuments(
  a: VectorDocument,
  b: VectorDocument,
  u: number,
): VectorDocument {
  if (!vectorDocumentsCompatible(a, b)) return u < 1 ? a : b
  const t = Math.max(0, Math.min(1, u))
  const next = cloneVectorDocument(a)
  for (let i = 0; i < next.items.length; i++) {
    const fromItem = a.items[i]!
    const toItem = b.items[i]!
    const item = next.items[i]!
    for (const id of Object.keys(item.geometry.points)) {
      const from = fromItem.geometry.points[id]!
      const to = toItem.geometry.points[id]!
      item.geometry.points[id] = {
        ...from,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }
    }
    for (const id of Object.keys(item.geometry.segments)) {
      const from = fromItem.geometry.segments[id]!
      const to = toItem.geometry.segments[id]!
      const segment = item.geometry.segments[id]!
      segment.kind =
        from.kind === 'cubic' || to.kind === 'cubic' ? 'cubic' : 'line'
      if (from.controlStart || to.controlStart) {
        segment.controlStart = lerpOptional(
          from.controlStart,
          to.controlStart,
          t,
        )
      }
      if (from.controlEnd || to.controlEnd) {
        segment.controlEnd = lerpOptional(from.controlEnd, to.controlEnd, t)
      }
    }
    for (let fi = 0; fi < item.fills.length; fi++) {
      const fromFill = fromItem.fills[fi]
      const toFill = toItem.fills[fi]
      if (
        fromFill?.kind === 'solid' &&
        toFill?.kind === 'solid' &&
        item.fills[fi]?.kind === 'solid'
      ) {
        item.fills[fi] = { ...fromFill }
      }
    }
  }
  return next
}

function lerpOptional(
  a: VectorPosition | undefined,
  b: VectorPosition | undefined,
  t: number,
): VectorPosition | undefined {
  if (!a && !b) return undefined
  const from = a ?? b!
  const to = b ?? a!
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
}

export function listVectorEditHandles(item: VectorItem): Array<{
  segmentId: string
  which: 'start' | 'end'
  anchor: VectorPoint
  control: VectorPosition
}> {
  const handles: Array<{
    segmentId: string
    which: 'start' | 'end'
    anchor: VectorPoint
    control: VectorPosition
  }> = []
  for (const segment of Object.values(item.geometry.segments)) {
    const start = item.geometry.points[segment.startPointId]
    const end = item.geometry.points[segment.endPointId]
    if (!start || !end) continue
    const controlStart =
      segment.controlStart ?? lerpPoint(start, end, 1 / 3)
    const controlEnd = segment.controlEnd ?? lerpPoint(start, end, 2 / 3)
    handles.push({
      segmentId: segment.id,
      which: 'start',
      anchor: start,
      control: controlStart,
    })
    handles.push({
      segmentId: segment.id,
      which: 'end',
      anchor: end,
      control: controlEnd,
    })
  }
  return handles
}
