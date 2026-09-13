// SPDX-License-Identifier: Apache-2.0

import type { Fill, VectorPaint } from '@/scene/types'

/**
 * Bridge between the simple, CSS-angle-based `Fill` model (used by the
 * generic `FillField` popover for frame/rect appearance) and the richer,
 * SVG-space `VectorPaint` model vector items actually render with.
 *
 * Reused rather than duplicated: `FillField` already has a mature
 * Figma-style gradient editor (stops, tabs, swatches). These converters let
 * the vector Fill row drive that same picker instead of building a second
 * one, at the cost of a small, self-consistent angle/vector translation for
 * linear gradients and a fixed 0.5 default radius for radial ones.
 */

/** CSS `linear-gradient` angle convention: 0deg points up, clockwise positive. */
function angleToDirection(angleDeg: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.sin(rad), dy: -Math.cos(rad) }
}

function directionToAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}

export function vectorPaintToFill(paint: VectorPaint): Fill {
  switch (paint.kind) {
    case 'solid':
      return { kind: 'solid', color: paint.color }
    case 'linear': {
      const dx = paint.end.x - paint.start.x
      const dy = paint.end.y - paint.start.y
      return { kind: 'linear', stops: paint.stops, angle: directionToAngle(dx, dy) }
    }
    case 'radial':
      return {
        kind: 'radial',
        stops: paint.stops,
        cx: paint.center.x,
        cy: paint.center.y,
        shape: paint.radiusX === paint.radiusY ? 'circle' : 'ellipse',
      }
    case 'conic':
      return {
        kind: 'conic',
        stops: paint.stops,
        angle: paint.angle,
        cx: paint.center.x,
        cy: paint.center.y,
      }
    case 'image':
      return { kind: 'image', src: paint.src, fit: paint.fit }
  }
}

export function fillToVectorPaint(fill: Fill): VectorPaint {
  const base = {
    id: 'fill-1',
    visible: true,
    opacity: 1,
    blendMode: 'normal' as const,
  }
  switch (fill.kind) {
    case 'solid':
      return { ...base, kind: 'solid', color: fill.color }
    case 'linear': {
      const { dx, dy } = angleToDirection(fill.angle)
      return {
        ...base,
        kind: 'linear',
        stops: fill.stops,
        start: { x: 0.5 - dx * 0.5, y: 0.5 - dy * 0.5 },
        end: { x: 0.5 + dx * 0.5, y: 0.5 + dy * 0.5 },
        coordinateSpace: 'objectBoundingBox',
      }
    }
    case 'radial':
      return {
        ...base,
        kind: 'radial',
        stops: fill.stops,
        center: { x: fill.cx, y: fill.cy },
        radiusX: 0.5,
        radiusY: fill.shape === 'ellipse' ? 0.4 : 0.5,
        rotation: 0,
        coordinateSpace: 'objectBoundingBox',
      }
    case 'conic':
      return {
        ...base,
        kind: 'conic',
        stops: fill.stops,
        center: { x: fill.cx, y: fill.cy },
        angle: fill.angle,
        coordinateSpace: 'objectBoundingBox',
      }
    case 'image':
      return { ...base, kind: 'image', src: fill.src, fit: fill.fit }
  }
}
