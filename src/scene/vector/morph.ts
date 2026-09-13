// SPDX-License-Identifier: Apache-2.0

import type {
  GradientStop,
  VectorDocument,
  VectorGeometry,
  VectorPaint,
  VectorPoint,
  VectorPosition,
  VectorStroke,
  VectorViewBox,
} from '@/scene/types'
import {
  cloneVectorDocument,
  lerpVectorDocuments,
  vectorDocumentsCompatible,
} from './edit'
import { parseSvgPathData } from './path'

export class MorphPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MorphPathError'
  }
}

export interface MorphPathInput {
  geometry: VectorGeometry
  /**
   * Paint carried by the pasted source, when there is one to read (a full
   * `<svg>` snippet with `fill="..."` or a gradient def). A bare `d="..."`
   * string has no paint of its own, so this comes back empty and the
   * morph target keeps whatever fill the vector already had.
   */
  fills: VectorPaint[]
  /** Stroke carried by the pasted source, same "empty means unchanged" rule as `fills`. */
  strokes: VectorStroke[]
}

/**
 * Parse a raw SVG `d` string or a small `<svg>` snippet into geometry (and,
 * for a full snippet, its fill/gradient).
 *
 * Regex-based, deliberately — this runs on untrusted pasted text and must
 * work in every environment (including plain Node, for tests) without a
 * DOMParser. `parseSvgDocument` (svg.ts) is the real, DOM-backed importer
 * and is not reused here for that reason.
 */
export function parseMorphPathInput(raw: string): MorphPathInput {
  const text = raw.trim()
  if (!text) throw new MorphPathError('Paste SVG path data or a small SVG.')
  if (text.startsWith('<')) {
    const matches = [...text.matchAll(/<path\b[^>]*>/gi)]
    const datas = matches
      .map((match) => match[0].match(/\bd\s*=\s*("([^"]*)"|'([^']*)')/i))
      .map((match) => (match?.[2] ?? match?.[3] ?? '').trim())
      .filter(Boolean)
    if (datas.length === 0) {
      throw new MorphPathError('No path data found in the SVG.')
    }
    const merged: VectorGeometry = { points: {}, segments: {}, contours: [] }
    datas.forEach((data, index) => {
      let parsed: VectorGeometry
      try {
        parsed = parseSvgPathData(data, { idPrefix: `morph-${index}` })
      } catch {
        throw new MorphPathError('Could not parse the SVG path data.')
      }
      Object.assign(merged.points, parsed.points)
      Object.assign(merged.segments, parsed.segments)
      merged.contours.push(...parsed.contours)
    })
    if (Object.keys(merged.segments).length === 0) {
      throw new MorphPathError('Could not parse the SVG path data.')
    }
    // A single pasted shape is the common case — the first path's own fill
    // and stroke (solid color or gradient def) are the representative
    // target paint.
    const fills = readMorphSvgFill(text, matches[0]![0])
    const strokes = readMorphSvgStroke(text, matches[0]![0])
    return { geometry: merged, fills, strokes }
  }
  try {
    const geometry = parseSvgPathData(text, { idPrefix: 'morph' })
    if (Object.keys(geometry.segments).length === 0) {
      throw new MorphPathError('Could not parse the SVG path data.')
    }
    return { geometry, fills: [], strokes: [] }
  } catch (error) {
    if (error instanceof MorphPathError) throw error
    throw new MorphPathError('Could not parse the SVG path data.')
  }
}

/**
 * Regex-only fill/gradient reader for a pasted SVG snippet — the `d="..."`
 * sibling of the geometry parser above, same DOMParser-free constraint.
 * Reads the first `<path>`'s own `fill`, falling back to the root `<svg>`
 * element's `fill` (the common "one fill, set on the wrapper" shape Figma's
 * copy-as-SVG produces). `url(#id)` resolves against a `<linearGradient>`/
 * `<radialGradient id="id">` def elsewhere in the snippet.
 */
function readMorphSvgFill(fullSvg: string, pathTag: string): VectorPaint[] {
  return resolveSvgPaintAttr(fullSvg, pathTag, 'fill', 'morph-fill')
}

/**
 * Same idea as {@link readMorphSvgFill}, but for `stroke`/`stroke-width` —
 * the pasted shape's own outline, solid or gradient.
 */
function readMorphSvgStroke(
  fullSvg: string,
  pathTag: string,
): VectorStroke[] {
  const paint = resolveSvgPaintAttr(fullSvg, pathTag, 'stroke', 'morph-stroke-paint')
  if (paint.length === 0) return []
  const widthRaw = pathTag.match(/\bstroke-width\s*=\s*("([^"]*)"|'([^']*)')/i)
  const width = Number.parseFloat(widthRaw?.[2] ?? widthRaw?.[3] ?? '1')
  return [
    {
      id: 'morph-stroke',
      paint: paint[0]!,
      width: Number.isFinite(width) && width > 0 ? width : 1,
      align: 'center',
      cap: 'butt',
      join: 'miter',
      miterLimit: 4,
      dash: [],
      dashOffset: 0,
      opacity: 1,
      visible: true,
    },
  ]
}

/**
 * Resolve a `fill` or `stroke` SVG paint attribute (solid color, or
 * `url(#id)` pointing at a `<linearGradient>`/`<radialGradient>` def) into
 * a VectorPaint. Shared by both readers above.
 */
function resolveSvgPaintAttr(
  fullSvg: string,
  pathTag: string,
  attrName: 'fill' | 'stroke',
  paintId: string,
): VectorPaint[] {
  const attrPattern = new RegExp(`\\b${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const ownValue = pathTag.match(attrPattern)
  const rootValue = fullSvg.match(/<svg\b[^>]*>/i)?.[0].match(attrPattern)
  const raw = (ownValue?.[2] ?? ownValue?.[3] ?? rootValue?.[2] ?? rootValue?.[3] ?? '').trim()
  if (!raw || raw === 'none') return []
  const urlRef = raw.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/i)?.[1]
  if (!urlRef) {
    return [
      { id: paintId, kind: 'solid', color: raw, visible: true, opacity: 1, blendMode: 'normal' },
    ]
  }
  const defMatch = fullSvg.match(
    new RegExp(
      `<(linearGradient|radialGradient)\\b[^>]*\\bid\\s*=\\s*["']${escapeRegExp(urlRef)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i',
    ),
  )
  if (!defMatch) return []
  const kind = defMatch[1]!.toLowerCase()
  const body = defMatch[2] ?? ''
  const openTag = defMatch[0].match(new RegExp(`<${defMatch[1]}\\b[^>]*>`, 'i'))?.[0] ?? ''
  const stops = readMorphGradientStops(body)
  if (stops.length === 0) return []
  const attr = (name: string, fallback: number) => {
    const raw = openTag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
    const value = raw?.[2] ?? raw?.[3]
    if (!value) return fallback
    const percent = value.trim().endsWith('%')
    const num = Number.parseFloat(value)
    if (!Number.isFinite(num)) return fallback
    return percent ? num / 100 : num
  }
  // SVG gradients default to `objectBoundingBox` (x1/y1/x2/y2 etc as 0..1
  // fractions of the shape) unless the def explicitly opts into raw
  // path-space coordinates. Losing this flag made every pasted gradient
  // draw across a ~1-unit sliver inside a shape dozens of units wide — the
  // whole visible shape then just sampled the clamp color past the last
  // stop, reading as a flat fill "out of frame."
  const gradientUnitsRaw = openTag.match(/\bgradientUnits\s*=\s*("([^"]*)"|'([^']*)')/i)
  const coordinateSpace =
    (gradientUnitsRaw?.[2] ?? gradientUnitsRaw?.[3]) === 'userSpaceOnUse'
      ? ('userSpaceOnUse' as const)
      : ('objectBoundingBox' as const)
  if (kind === 'lineargradient') {
    return [
      {
        id: paintId,
        kind: 'linear',
        stops,
        start: { x: attr('x1', 0), y: attr('y1', 0) },
        end: { x: attr('x2', 1), y: attr('y2', 0) },
        coordinateSpace,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
      },
    ]
  }
  return [
    {
      id: paintId,
      kind: 'radial',
      stops,
      center: { x: attr('cx', 0.5), y: attr('cy', 0.5) },
      radiusX: attr('r', 0.5),
      radiusY: attr('r', 0.5),
      rotation: 0,
      coordinateSpace,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    },
  ]
}

function readMorphGradientStops(gradientBody: string): GradientStop[] {
  const stops: GradientStop[] = []
  for (const match of gradientBody.matchAll(/<stop\b[^>]*\/?>/gi)) {
    const tag = match[0]
    const offsetRaw = tag.match(/\boffset\s*=\s*("([^"]*)"|'([^']*)')/i)
    const offsetValue = (offsetRaw?.[2] ?? offsetRaw?.[3] ?? '0').trim()
    const at = offsetValue.endsWith('%')
      ? Number.parseFloat(offsetValue) / 100
      : Number.parseFloat(offsetValue)
    const colorRaw = tag.match(/\bstop-color\s*=\s*("([^"]*)"|'([^']*)')/i)
    const color = (colorRaw?.[2] ?? colorRaw?.[3] ?? '#000000').trim()
    if (!Number.isFinite(at)) continue
    stops.push({ at: Math.max(0, Math.min(1, at)), color })
  }
  return stops
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function fitGeometryToViewBox(
  geometry: VectorGeometry,
  viewBox: VectorViewBox,
): VectorGeometry {
  const bounds = geometryBounds(geometry)
  const next = structuredClone(geometry)
  if (!bounds) return next
  const scaleX = bounds.width === 0 ? 1 : viewBox.width / bounds.width
  const scaleY = bounds.height === 0 ? 1 : viewBox.height / bounds.height
  const scale = Math.min(scaleX, scaleY) * 0.92
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const tx = viewBox.x + viewBox.width / 2
  const ty = viewBox.y + viewBox.height / 2
  const map = (p: VectorPosition): VectorPosition => ({
    x: (p.x - cx) * scale + tx,
    y: (p.y - cy) * scale + ty,
  })
  for (const id of Object.keys(next.points)) {
    const point = next.points[id]!
    const mapped = map(point)
    next.points[id] = { ...point, ...mapped }
  }
  for (const segment of Object.values(next.segments)) {
    if (segment.controlStart) segment.controlStart = map(segment.controlStart)
    if (segment.controlEnd) segment.controlEnd = map(segment.controlEnd)
  }
  return next
}

/**
 * Rebuild `to` onto `from`'s point/segment ids so lerp can interpolate
 * unlike shapes (triangle → square). Extra target contours are ignored;
 * extra source contours reuse the last target contour.
 */
export function remapVectorGeometry(
  from: VectorGeometry,
  to: VectorGeometry,
): VectorGeometry {
  const next = structuredClone(from)
  if (from.contours.length === 0 || to.contours.length === 0) return next
  for (let i = 0; i < from.contours.length; i++) {
    const fromContour = from.contours[i]!
    const toContour = to.contours[Math.min(i, to.contours.length - 1)]!
    const fromAnchors = contourAnchors(from, fromContour.id)
    const toAnchors = contourAnchors(to, toContour.id)
    if (fromAnchors.length === 0) continue
    const sampled = resamplePolyline(
      toAnchors,
      fromAnchors.length,
      fromContour.closed || toContour.closed,
    )
    fromAnchors.forEach((anchor, index) => {
      const sample = sampled[index] ?? sampled[sampled.length - 1]!
      const point = next.points[anchor.id]
      if (point) next.points[anchor.id] = { ...point, x: sample.x, y: sample.y }
    })
  }
  for (const segment of Object.values(next.segments)) {
    const start = next.points[segment.startPointId]
    const end = next.points[segment.endPointId]
    if (!start || !end) continue
    if (segment.kind === 'cubic' || segment.controlStart || segment.controlEnd) {
      segment.kind = 'cubic'
      segment.controlStart = lerpPos(start, end, 1 / 3)
      segment.controlEnd = lerpPos(start, end, 2 / 3)
    }
  }
  return next
}

export function applyMorphTarget(
  source: VectorDocument,
  targetGeometry: VectorGeometry,
  viewBox: VectorViewBox,
  targetFills?: VectorPaint[],
  targetStrokes?: VectorStroke[],
): VectorDocument {
  const next = cloneVectorDocument(source)
  const item = next.items[0]
  if (!item) {
    throw new MorphPathError('This vector has no path to morph.')
  }
  const fitted = fitGeometryToViewBox(targetGeometry, viewBox)
  item.geometry = remapVectorGeometry(item.geometry, fitted)
  // A pasted plain `d="..."` string carries no paint, so an empty/omitted
  // `targetFills`/`targetStrokes` leaves the vector's current fill/stroke
  // untouched — same as before either carried paint at all.
  if (targetFills && targetFills.length > 0) {
    item.fills = structuredClone(targetFills)
  }
  if (targetStrokes && targetStrokes.length > 0) {
    item.strokes = structuredClone(targetStrokes)
  }
  return next
}

/** Same-id lerp, or remap `b` onto `a`'s graph when topologies differ. */
export function lerpMorphedVectorDocuments(
  a: VectorDocument,
  b: VectorDocument,
  u: number,
): VectorDocument {
  if (vectorDocumentsCompatible(a, b)) return lerpVectorDocuments(a, b, u)
  const bridged = cloneVectorDocument(a)
  const count = Math.min(a.items.length, b.items.length)
  for (let i = 0; i < count; i++) {
    bridged.items[i]!.geometry = remapVectorGeometry(
      a.items[i]!.geometry,
      b.items[i]!.geometry,
    )
  }
  if (!vectorDocumentsCompatible(a, bridged)) return u < 1 ? a : b
  return lerpVectorDocuments(a, bridged, u)
}

function geometryBounds(
  geometry: VectorGeometry,
): { x: number; y: number; width: number; height: number } | null {
  const points = Object.values(geometry.points)
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (p: VectorPosition) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const point of points) consider(point)
  for (const segment of Object.values(geometry.segments)) {
    if (segment.controlStart) consider(segment.controlStart)
    if (segment.controlEnd) consider(segment.controlEnd)
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function contourAnchors(
  geometry: VectorGeometry,
  contourId: string,
): VectorPoint[] {
  const contour = geometry.contours.find((entry) => entry.id === contourId)
  if (!contour) return []
  const anchors: VectorPoint[] = []
  const seen = new Set<string>()
  const first = geometry.segments[contour.segmentIds[0] ?? '']
  if (first) {
    const start = geometry.points[first.startPointId]
    if (start) {
      anchors.push(start)
      seen.add(start.id)
    }
  }
  for (const segmentId of contour.segmentIds) {
    const segment = geometry.segments[segmentId]
    const end = segment ? geometry.points[segment.endPointId] : undefined
    if (!end || seen.has(end.id)) continue
    anchors.push(end)
    seen.add(end.id)
  }
  return anchors
}

function resamplePolyline(
  points: VectorPosition[],
  count: number,
  closed: boolean,
): VectorPosition[] {
  if (count <= 0) return []
  if (points.length === 0) {
    return Array.from({ length: count }, () => ({ x: 0, y: 0 }))
  }
  if (points.length === 1) {
    return Array.from({ length: count }, () => ({ ...points[0]! }))
  }
  const ring = closed ? [...points, points[0]!] : points
  const lengths: number[] = [0]
  for (let i = 1; i < ring.length; i++) {
    lengths.push(lengths[i - 1]! + distance(ring[i - 1]!, ring[i]!))
  }
  const total = lengths[lengths.length - 1]!
  if (total === 0) {
    return Array.from({ length: count }, () => ({ ...points[0]! }))
  }
  const samples: VectorPosition[] = []
  for (let i = 0; i < count; i++) {
    const t = closed ? (i / count) * total : (count === 1 ? 0 : (i / (count - 1)) * total)
    samples.push(pointAtLength(ring, lengths, t))
  }
  return samples
}

function pointAtLength(
  ring: VectorPosition[],
  lengths: number[],
  t: number,
): VectorPosition {
  const target = Math.min(Math.max(0, t), lengths[lengths.length - 1]!)
  let index = 1
  while (index < lengths.length && lengths[index]! < target) index += 1
  const start = ring[index - 1]!
  const end = ring[index] ?? start
  const span = lengths[index]! - lengths[index - 1]!
  const u = span === 0 ? 0 : (target - lengths[index - 1]!) / span
  return lerpPos(start, end, u)
}

function distance(a: VectorPosition, b: VectorPosition): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function lerpPos(a: VectorPosition, b: VectorPosition, t: number): VectorPosition {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}
