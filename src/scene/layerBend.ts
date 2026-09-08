// SPDX-License-Identifier: Apache-2.0

import type { LayerBend } from '@/scene/types'

export const DEFAULT_LAYER_BEND: LayerBend = {
  tl: 0,
  tr: 0,
  br: 0,
  bl: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

export function normalizeLayerBend(value: unknown): LayerBend {
  const source =
    value && typeof value === 'object' ? (value as Partial<LayerBend>) : {}
  return {
    tl: finite(source.tl),
    tr: finite(source.tr),
    br: finite(source.br),
    bl: finite(source.bl),
    top: finite(source.top),
    right: finite(source.right),
    bottom: finite(source.bottom),
    left: finite(source.left),
  }
}

export function layerBendIsActive(bend: LayerBend | undefined | null): boolean {
  if (!bend) return false
  return (
    bend.tl !== 0 ||
    bend.tr !== 0 ||
    bend.br !== 0 ||
    bend.bl !== 0 ||
    bend.top !== 0 ||
    bend.right !== 0 ||
    bend.bottom !== 0 ||
    bend.left !== 0
  )
}

export function mergeLayerBend(
  base: LayerBend | undefined,
  patch: Partial<LayerBend> | undefined,
): LayerBend {
  return normalizeLayerBend({ ...DEFAULT_LAYER_BEND, ...base, ...patch })
}

/**
 * How strongly a Z lift also tucks the vertex toward the plane center.
 * Front-facing cameras barely show Z-only displacement; this keeps the
 * silhouette changing without requiring a camera orbit.
 */
export const LAYER_BEND_INPLANE = 0.4

/**
 * Evaluate Z displacement in parent-local UV space (u,v in 0..1, v down).
 *
 * Corners use bilinear interpolation. Edge values add a raised cosine bump
 * along that side so a side can bend independently of its corners.
 */
export function evaluateLayerBendZ(
  u: number,
  v: number,
  bend: LayerBend,
): number {
  const uu = clamp01(u)
  const vv = clamp01(v)
  const corners =
    (1 - uu) * (1 - vv) * bend.tl +
    uu * (1 - vv) * bend.tr +
    uu * vv * bend.br +
    (1 - uu) * vv * bend.bl
  const top = bend.top * bump(uu) * (1 - vv)
  const bottom = bend.bottom * bump(uu) * vv
  const left = bend.left * bump(vv) * (1 - uu)
  const right = bend.right * bump(vv) * uu
  return corners + top + bottom + left + right
}

/**
 * In-plane offset in Three.js plane local space (y up) for a rest-pose vertex.
 * Positive Z tucks toward the center, like a page corner lifting.
 */
export function evaluateLayerBendInPlane(
  u: number,
  v: number,
  z: number,
  inplane: number = LAYER_BEND_INPLANE,
): { dx: number; dy: number } {
  return {
    dx: (0.5 - clamp01(u)) * z * inplane,
    dy: (clamp01(v) - 0.5) * z * inplane,
  }
}

function bump(t: number): number {
  return Math.sin(Math.PI * clamp01(t))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
