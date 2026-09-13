// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { VectorNode } from '@/scene'
import { applyVectorFill, applyVectorStroke, cloneVectorDocument } from '@/scene/vector'
import { vectorEditPreviewStore } from '@/ui/vectorEditPreviewStore'

export function resolveDisplayedVectorNode(
  node: VectorNode,
  anim?: AnimatedValue,
): VectorNode {
  const preview = vectorEditPreviewStore.getSnapshot()[node.id]
  let vector = preview ?? anim?.vectorGeometry ?? node.vector
  // A geometry track's own embedded fill/stroke rides through untouched —
  // each shape keyframe can carry its own paint (see morph.ts's target
  // fill/stroke carryover). An explicit vector.fill/vector.stroke track
  // still wins when one exists: that's a deliberate, separately-authored
  // paint animation layered on top of the shape.
  const fill = anim?.vectorFill
  if (fill) vector = applyVectorFill(vector, fill)
  const stroke = anim?.vectorStroke
  if (stroke) vector = applyVectorStroke(vector, stroke)
  if (
    vector === node.vector &&
    !preview &&
    !anim?.vectorGeometry &&
    !fill &&
    !stroke
  ) {
    return node
  }
  return {
    ...node,
    vector: vector === node.vector ? cloneVectorDocument(vector) : vector,
  }
}
