// SPDX-License-Identifier: Apache-2.0

import type {
  BendDeformation,
  DeformationVector3,
  LayerDeformation,
} from './types'

export const MIN_BEND_GEOMETRY_DETAIL = 4
export const MAX_BEND_GEOMETRY_DETAIL = 128

export const DEFAULT_BEND_DEFORMATION: BendDeformation = Object.freeze({
  kind: 'bend',
  enabled: true,
  angle: 0,
  factor: 1,
  bothDirections: false,
  limitToRegion: true,
  showOriginalGeometry: false,
  captureDirection: Object.freeze({ x: 1, y: 0, z: 0 }),
  captureRotation: 0,
  upDirection: Object.freeze({ x: 0, y: 1, z: 0 }),
  upRotation: 0,
  bendRotation: 0,
  captureOrigin: Object.freeze({ x: 0, y: 0, z: 0 }),
  captureLength: 0,
  geometryDetail: 32,
})

export function normalizeLayerDeformation(
  value: unknown,
): LayerDeformation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<BendDeformation> & { kind?: unknown }
  if (source.kind !== 'bend') return null
  return {
    kind: 'bend',
    enabled: booleanValue(source.enabled, true),
    angle: finite(source.angle, 0),
    factor: clamp(finite(source.factor, 1), 0, 1),
    bothDirections: booleanValue(source.bothDirections, false),
    limitToRegion: booleanValue(source.limitToRegion, true),
    showOriginalGeometry: booleanValue(source.showOriginalGeometry, false),
    captureDirection: vector(source.captureDirection, { x: 1, y: 0, z: 0 }),
    captureRotation: finite(source.captureRotation, 0),
    upDirection: vector(source.upDirection, { x: 0, y: 1, z: 0 }),
    upRotation: finite(source.upRotation, 0),
    bendRotation: finite(source.bendRotation, 0),
    captureOrigin: vector(source.captureOrigin, { x: 0, y: 0, z: 0 }),
    captureLength: Math.max(0, finite(source.captureLength, 0)),
    geometryDetail: Math.round(
      clamp(
        finite(source.geometryDetail, DEFAULT_BEND_DEFORMATION.geometryDetail),
        MIN_BEND_GEOMETRY_DETAIL,
        MAX_BEND_GEOMETRY_DETAIL,
      ),
    ),
  }
}

function vector(
  value: unknown,
  fallback: DeformationVector3,
): DeformationVector3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback }
  }
  const source = value as Partial<DeformationVector3>
  return {
    x: finite(source.x, fallback.x),
    y: finite(source.y, fallback.y),
    z: finite(source.z, fallback.z),
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
