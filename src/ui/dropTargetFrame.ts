// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import type { SolvedLayout } from '@/layout'

/**
 * Only the fields this module actually reads off the caller's full
 * `InheritedAnim` map — kept narrow (rather than importing that type from
 * canvasRenderHelpers) so this stays a small, independently testable
 * geometry util instead of pulling in the whole render/persistence chain.
 * `Record<NodeId, InheritedAnim>` satisfies this structurally.
 */
export interface DropInheritedAnim {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

const IDENTITY_INHERITED: DropInheritedAnim = { x: 0, y: 0, scaleX: 1, scaleY: 1 }

export interface DropTarget {
  /** The frame the dropped content should be parented under. */
  parentId: NodeId
  /** Drop position converted into that frame's own content-box space. */
  local: { x: number; y: number }
}

/**
 * Resolve which frame a canvas-space drop point actually lands inside, so
 * dropped files/components nest into e.g. a device mockup's Screen frame
 * instead of always landing on the artboard root — a plain root-level
 * sibling that happens to overlap on screen, but doesn't move with its
 * "container" because it isn't actually parented to it.
 *
 * Deliberately geometry-only (SolvedLayout + accumulated ancestor
 * transform), the same simplification SelectionOverlay already makes for
 * 2D on-canvas chrome — it ignores rotation, so a heavily rotated frame
 * won't be picked up as a drop target. That mirrors the rest of the
 * editor's 2D interaction chrome rather than the full 3D-camera-projected
 * renderer, and is enough for the common case (flat frames, including
 * device mockups) this exists to fix.
 */
/** True if `id` is `ancestorCandidate` itself or a descendant of it. */
function isSelfOrDescendant(
  api: SceneAPI,
  id: NodeId,
  ancestorCandidate: NodeId,
): boolean {
  let cursor: NodeId | null = id
  while (cursor) {
    if (cursor === ancestorCandidate) return true
    cursor = api.getNode(cursor)?.parent ?? null
  }
  return false
}

/**
 * A frame's absolute canvas-space top-left, from the solved layout plus
 * its own and every ancestor's accumulated transform offset. Root is
 * always the origin.
 */
export function absoluteFrameOrigin(
  api: SceneAPI,
  solved: SolvedLayout,
  inherited: Record<NodeId, DropInheritedAnim>,
  rootId: NodeId,
  id: NodeId,
): { x: number; y: number } {
  if (id === rootId) return { x: 0, y: 0 }
  const node = api.getNode(id)
  const base = solved[id]
  if (!node || !base) return { x: 0, y: 0 }
  const inh = inherited[id] ?? IDENTITY_INHERITED
  return { x: base.x + node.transform.x + inh.x, y: base.y + node.transform.y + inh.y }
}

export function findDropTargetFrame(
  api: SceneAPI,
  solved: SolvedLayout,
  inherited: Record<NodeId, DropInheritedAnim>,
  rootId: NodeId,
  point: { x: number; y: number },
  /**
   * Exclude this node and its whole subtree from candidacy — dragging an
   * existing frame around the canvas must never reparent it into itself
   * or one of its own children, which would otherwise happen if the
   * pointer sits over a nested child frame while dragging the parent.
   */
  excludeSubtreeRootId?: NodeId,
): DropTarget {
  let best: { id: NodeId; x: number; y: number; depth: number } | null = null

  for (const id of Object.keys(solved)) {
    if (id === rootId) continue
    if (excludeSubtreeRootId && isSelfOrDescendant(api, id, excludeSubtreeRootId)) {
      continue
    }
    const node = api.getNode(id)
    if (!node || node.kind !== 'frame' || !node.visible || node.locked) continue
    const base = solved[id]
    if (!base) continue
    const inh = inherited[id] ?? IDENTITY_INHERITED
    const x = base.x + node.transform.x + inh.x
    const y = base.y + node.transform.y + inh.y
    const width = base.width * (inh.scaleX || 1)
    const height = base.height * (inh.scaleY || 1)
    if (
      point.x < x ||
      point.x > x + width ||
      point.y < y ||
      point.y > y + height
    ) {
      continue
    }

    let depth = 0
    let cursor = node.parent
    while (cursor && cursor !== rootId) {
      depth++
      cursor = api.getNode(cursor)?.parent ?? null
    }
    // Prefer the most deeply nested match — a mockup's Screen frame over
    // the mockup's own outer frame when both contain the point.
    if (!best || depth > best.depth) {
      best = { id, x, y, depth }
    }
  }

  if (!best) return { parentId: rootId, local: point }
  return {
    parentId: best.id,
    local: { x: point.x - best.x, y: point.y - best.y },
  }
}
