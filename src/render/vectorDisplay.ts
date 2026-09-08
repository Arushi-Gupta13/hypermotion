// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { VectorNode } from '@/scene'
import {
  applyVectorFillColor,
  cloneVectorDocument,
} from '@/scene/vector'
import { vectorEditPreviewStore } from '@/ui/vectorEditPreviewStore'

export function resolveDisplayedVectorNode(
  node: VectorNode,
  anim?: AnimatedValue,
): VectorNode {
  const preview = vectorEditPreviewStore.getSnapshot()[node.id]
  let vector = preview ?? anim?.vectorGeometry ?? node.vector
  const fill = anim?.vectorFill
  if (fill) vector = applyVectorFillColor(vector, fill)
  if (vector === node.vector && !preview && !anim?.vectorGeometry && !fill) {
    return node
  }
  return {
    ...node,
    vector: vector === node.vector ? cloneVectorDocument(vector) : vector,
  }
}
