// SPDX-License-Identifier: Apache-2.0

import type { LayerBend } from '@/scene'
import {
  DEFAULT_LAYER_BEND,
  evaluateLayerBendInPlane,
  evaluateLayerBendZ,
  layerBendIsActive,
  mergeLayerBend,
} from '@/scene/layerBend'
import type { AnimatedValue } from '@/anim'
import { add3, dot3, mul3, sub3, type Vec3 } from '@/render3d/math'

export interface ParentBendField {
  center: Vec3
  right: Vec3
  down: Vec3
  normal: Vec3
  width: number
  height: number
  bend: LayerBend
}

export function resolvedLayerBend(
  node: { layerBend?: LayerBend },
  anim?: AnimatedValue,
): LayerBend {
  return mergeLayerBend(node.layerBend, {
    tl: anim?.bendTl,
    tr: anim?.bendTr,
    br: anim?.bendBr,
    bl: anim?.bendBl,
    top: anim?.bendTop,
    right: anim?.bendRight,
    bottom: anim?.bendBottom,
    left: anim?.bendLeft,
  })
}

export const LAYER_BEND_SEGMENTS = 16

export function planeNeedsBendMesh(plane: {
  bend?: LayerBend
  parentBendFields?: ParentBendField[]
}): boolean {
  return (
    layerBendIsActive(plane.bend) ||
    (plane.parentBendFields?.some((field) => layerBendIsActive(field.bend)) ??
      false)
  )
}

export function applyPlaneBendGeometry(
  geometry: {
    parameters?: {
      width: number
      height: number
      widthSegments: number
      heightSegments: number
    }
    attributes: {
      position: {
        count: number
        getX: (i: number) => number
        getY: (i: number) => number
        setXYZ: (i: number, x: number, y: number, z: number) => void
        needsUpdate: boolean
      }
    }
    computeVertexNormals: () => void
  },
  plane: {
    center: Vec3
    right: Vec3
    down: Vec3
    normal: Vec3
    rect: { width: number; height: number }
    scaleX: number
    scaleY: number
    bend?: LayerBend
    parentBendFields?: ParentBendField[]
  },
): void {
  const restSize = geometry.parameters
  const width = restSize?.width || plane.rect.width
  const height = restSize?.height || plane.rect.height
  const own = plane.bend
  const fields = plane.parentBendFields ?? []
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const rest = restVertex(geometry, i)
    const x = rest.x
    const y = rest.y
    const u = width === 0 ? 0.5 : x / width + 0.5
    const v = height === 0 ? 0.5 : 0.5 - y / height
    let z = own ? evaluateLayerBendZ(u, v, own) : 0
    if (fields.length > 0) {
      const world = add3(
        plane.center,
        add3(
          mul3(plane.right, x * Math.abs(plane.scaleX)),
          mul3(plane.down, -y * Math.abs(plane.scaleY)),
        ),
      )
      for (const field of fields) {
        if (!layerBendIsActive(field.bend)) continue
        const rel = sub3(world, field.center)
        const pu =
          field.width === 0
            ? 0.5
            : dot3(rel, field.right) / field.width + 0.5
        const pv =
          field.height === 0
            ? 0.5
            : dot3(rel, field.down) / field.height + 0.5
        z += evaluateLayerBendZ(pu, pv, field.bend)
      }
    }
    const { dx, dy } = evaluateLayerBendInPlane(u, v, z)
    positions.setXYZ(i, x + dx, y + dy, z)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
}

function restVertex(
  geometry: {
    parameters?: {
      width: number
      height: number
      widthSegments: number
      heightSegments: number
    }
    attributes: {
      position: {
        getX: (i: number) => number
        getY: (i: number) => number
      }
    }
  },
  i: number,
): { x: number; y: number } {
  const params = geometry.parameters
  const gridX = params?.widthSegments
  const gridY = params?.heightSegments
  if (
    params &&
    gridX !== undefined &&
    gridY !== undefined &&
    gridX > 0 &&
    gridY > 0
  ) {
    const cols = gridX + 1
    const ix = i % cols
    const iy = Math.floor(i / cols)
    return {
      x: (ix / gridX) * params.width - params.width / 2,
      y: (iy / gridY) * params.height - params.height / 2,
    }
  }
  return {
    x: geometry.attributes.position.getX(i),
    y: geometry.attributes.position.getY(i),
  }
}

export { DEFAULT_LAYER_BEND, layerBendIsActive }
