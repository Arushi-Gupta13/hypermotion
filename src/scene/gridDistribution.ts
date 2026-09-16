// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { Node, NodeId } from '@/scene/types'

/**
 * "Arrange" — a one-shot distribute action offering Radial / Path /
 * Spherical layout modes. Rather than a persistent live generator, this
 * computes each selected node's transform once and writes it directly;
 * re-running with different params simply recomputes from the same
 * anchor, which reads as "live" while the Inspector panel is open (every
 * param edit calls applyGridDistribution again) without needing a
 * persistent generator node or renderer changes.
 */

export type GridDistributionKind = 'radial' | 'path' | 'spherical' | 'ring'

export interface RadialDistributionParams {
  kind: 'radial'
  /** Distance from the anchor, in canvas pixels. */
  radius: number
  /** Degrees; 0 = up, increasing clockwise (matches the app's angle convention). */
  startAngle: number
  /** Degrees swept across all items. 360 wraps evenly with no seam. */
  sweep: number
  /** Rotate each item to face outward from the anchor. */
  faceOutward: boolean
}

export interface PathDistributionParams {
  kind: 'path'
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Perpendicular bow offset at the path's midpoint, in canvas pixels. */
  curve: number
  /** Rotate each item to follow the path's local tangent. */
  followTangent: boolean
}

export interface SphericalDistributionParams {
  kind: 'spherical'
  radius: number
}

export interface RingDistributionParams {
  kind: 'ring'
  /** Distance from the ring's center axis, in canvas pixels. */
  radius: number
  /** Degrees; 0 = the +Z direction (toward the viewer), increasing clockwise when viewed from above. */
  startAngle: number
  /** Rotate each item around Y so it faces outward from the ring's center axis. */
  faceOutward: boolean
}

export type GridDistributionParams =
  | RadialDistributionParams
  | PathDistributionParams
  | SphericalDistributionParams
  | RingDistributionParams

export interface DistributedTransform {
  x: number
  y: number
  z: number
  rotation: number
  rotationX: number
  rotationY: number
}

export function defaultGridDistributionParams(
  kind: GridDistributionKind,
): GridDistributionParams {
  switch (kind) {
    case 'radial':
      return { kind: 'radial', radius: 200, startAngle: 0, sweep: 360, faceOutward: false }
    case 'path':
      return { kind: 'path', from: { x: -200, y: 0 }, to: { x: 200, y: 0 }, curve: 0, followTangent: false }
    case 'spherical':
      return { kind: 'spherical', radius: 220 }
    case 'ring':
      return { kind: 'ring', radius: 220, startAngle: 0, faceOutward: true }
  }
}

function angleToDirection(angleDeg: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.sin(rad), dy: -Math.cos(rad) }
}

function radialTransforms(
  params: RadialDistributionParams,
  count: number,
): DistributedTransform[] {
  const { radius, startAngle, sweep, faceOutward } = params
  const step = count <= 1 ? 0 : sweep / (sweep >= 360 ? count : Math.max(1, count - 1))
  const out: DistributedTransform[] = []
  for (let i = 0; i < count; i++) {
    const angle = startAngle + step * i
    const { dx, dy } = angleToDirection(angle)
    out.push({
      x: dx * radius,
      y: dy * radius,
      z: 0,
      rotation: faceOutward ? angle : 0,
      rotationX: 0,
      rotationY: 0,
    })
  }
  return out
}

function pathTransforms(
  params: PathDistributionParams,
  count: number,
): DistributedTransform[] {
  const { from, to, curve, followTangent } = params
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular unit vector, used to bow the path's control point.
  const px = -dy / len
  const py = dx / len
  const control = { x: mid.x + px * curve, y: mid.y + py * curve }

  const out: DistributedTransform[] = []
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0.5 : i / (count - 1)
    // Quadratic bezier through from → control → to.
    const omt = 1 - t
    const x = omt * omt * from.x + 2 * omt * t * control.x + t * t * to.x
    const y = omt * omt * from.y + 2 * omt * t * control.y + t * t * to.y
    let rotation = 0
    if (followTangent) {
      // Tangent of the quadratic bezier at t.
      const tx = 2 * omt * (control.x - from.x) + 2 * t * (to.x - control.x)
      const ty = 2 * omt * (control.y - from.y) + 2 * t * (to.y - control.y)
      rotation = (Math.atan2(tx, -ty) * 180) / Math.PI
    }
    out.push({ x, y, z: 0, rotation, rotationX: 0, rotationY: 0 })
  }
  return out
}

/**
 * Fibonacci-sphere distribution — evenly spaced points on a sphere
 * surface.
 *
 * The renderer paints planes in sibling/creation order with depth
 * testing disabled (see scene3d.ts's `hitTestPlanes` — later siblings
 * composite on top, like DOM stacking, not a z-buffer). A full sphere
 * puts roughly half its points on the far hemisphere with no
 * per-frame re-sort to keep them correctly hidden, so returning them
 * in raw Fibonacci-index order reads as a random jumble of squares —
 * whichever half happens to land later in the array wins, regardless
 * of which is actually nearer the camera. Sorting back-to-front by z
 * (the camera looks down +Z, so larger z is farther away) before
 * returning fixes this for the arrangement's resting pose: farthest
 * points are created first (painted first, on the bottom), nearest
 * points last (painted last, on top) — a standard painter's-algorithm
 * ordering. It only holds exactly at the pose this was computed for;
 * once the whole arrangement spins, the *true* front/back split keeps
 * changing while paint order can't, so some occlusion error returns
 * during rotation — an inherent limit of this renderer's planes, not
 * fixable by sorting harder. The sort is by unit-sphere z (before the
 * `radius` multiply), so it's stable across radius edits — regenerating
 * with a new radius doesn't shuffle which point owns which slot index.
 */
function sphericalTransforms(
  params: SphericalDistributionParams,
  count: number,
): DistributedTransform[] {
  const { radius } = params
  const points: { px: number; py: number; pz: number }[] = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const v = count <= 1 ? 0 : 1 - (i / (count - 1)) * 2
    const ringRadius = Math.sqrt(Math.max(0, 1 - v * v))
    const theta = goldenAngle * i
    points.push({ px: Math.cos(theta) * ringRadius, py: v, pz: Math.sin(theta) * ringRadius })
  }
  points.sort((a, b) => b.pz - a.pz)
  return points.map(({ px, py, pz }) => {
    // Face each item outward along the sphere's local normal.
    const rotationY = (Math.atan2(px, pz) * 180) / Math.PI
    const rotationX = (Math.asin(-py) * 180) / Math.PI
    return {
      x: px * radius,
      y: py * radius,
      z: pz * radius,
      rotation: 0,
      rotationX,
      rotationY,
    }
  })
}

/**
 * Evenly spaced points around a circle in the XZ plane (depth varies,
 * height doesn't) — a flat "bracelet"/tunnel ring you can walk or orbit
 * a camera around, as opposed to `radialTransforms`' flat XY-plane ring
 * (which just spaces items across the screen plane with no depth). Each
 * item can face outward around its own Y axis, matching how
 * `sphericalTransforms` orients its points but restricted to one band
 * instead of the whole sphere surface.
 */
function ringTransforms(
  params: RingDistributionParams,
  count: number,
): DistributedTransform[] {
  const { radius, startAngle, faceOutward } = params
  const step = count <= 1 ? 0 : 360 / count
  const out: DistributedTransform[] = []
  for (let i = 0; i < count; i++) {
    const angle = startAngle + step * i
    const rad = (angle * Math.PI) / 180
    const x = radius * Math.sin(rad)
    const z = radius * Math.cos(rad)
    out.push({
      x,
      y: 0,
      z,
      rotation: 0,
      rotationX: 0,
      rotationY: faceOutward ? angle : 0,
    })
  }
  return out
}

export function distributeTransforms(
  params: GridDistributionParams,
  count: number,
): DistributedTransform[] {
  if (count <= 0) return []
  switch (params.kind) {
    case 'radial':
      return radialTransforms(params, count)
    case 'path':
      return pathTransforms(params, count)
    case 'spherical':
      return sphericalTransforms(params, count)
    case 'ring':
      return ringTransforms(params, count)
  }
}

/**
 * Arranges `nodeIds` (in the given order) around their current centroid.
 * Writes absolute x/y/z/rotation/rotationX/rotationY directly — a one-shot
 * action, not a persistent generator. Call again with new params to
 * "re-arrange"; each call recomputes from the same centroid so it stays
 * stable across repeated edits in a panel.
 */
export function applyGridDistribution(
  api: SceneAPI,
  nodeIds: readonly NodeId[],
  params: GridDistributionParams,
): void {
  const nodes = nodeIds
    .map((id) => api.getNode(id))
    .filter((n): n is Node => n != null)
  if (nodes.length === 0) return

  // `transform.x/y` is each node's top-left offset, not its visual
  // center — arranging by the raw corner makes a ring/sphere read as
  // lopsided (every box hangs off to the right/below its plotted
  // point). Anchor and place by each node's own center instead, so
  // differently sized layers still land symmetrically on the shape.
  const centerOf = (node: Node): { x: number; y: number } => {
    const width = 'size' in node && typeof node.size.width === 'number' ? node.size.width : 0
    const height = 'size' in node && typeof node.size.height === 'number' ? node.size.height : 0
    return { x: node.transform.x + width / 2, y: node.transform.y + height / 2 }
  }

  const centroid = nodes.reduce(
    (acc, n) => {
      const c = centerOf(n)
      return { x: acc.x + c.x, y: acc.y + c.y }
    },
    { x: 0, y: 0 },
  )
  centroid.x /= nodes.length
  centroid.y /= nodes.length

  const transforms = distributeTransforms(params, nodes.length)

  api.doc.transact(() => {
    nodes.forEach((node, i) => {
      const t = transforms[i]
      if (!t) return
      if (node.position !== 'absolute') {
        api.setNodeProperty(node.id, 'position', 'absolute')
      }
      const width = 'size' in node && typeof node.size.width === 'number' ? node.size.width : 0
      const height = 'size' in node && typeof node.size.height === 'number' ? node.size.height : 0
      const targetCenterX = centroid.x + t.x
      const targetCenterY = centroid.y + t.y
      api.setNodeProperty(node.id, 'transform', {
        ...node.transform,
        x: targetCenterX - width / 2,
        y: targetCenterY - height / 2,
        z: node.transform.z + t.z,
        rotation: t.rotation,
        rotationX: t.rotationX,
        rotationY: t.rotationY,
      })
    })
    // Deliberately NOT tagged UNDOABLE_GESTURE_ORIGIN. The Inspector calls
    // this on every param tweak, including every tick of a slider drag
    // (NumberField falls back to firing onCommit continuously while
    // scrubbing) — UNDOABLE_GESTURE_ORIGIN's whole contract is "one call
    // = one complete gesture, keep it as its own undo step even if it
    // lands within Yjs's merge window," which is correct for a single
    // drag-release commit but turns EVERY tick of a live-applying slider
    // into its own separate, forced-non-mergeable undo entry — a two-
    // second radius drag became dozens of undo steps. The default (null)
    // origin is still tracked (see useKeyboardShortcuts.ts's
    // trackedOrigins) and lets Yjs's own 500ms captureTimeout do what
    // it's designed for: coalesce rapid consecutive edits into one step.
  })
}
