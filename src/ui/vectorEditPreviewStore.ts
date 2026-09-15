// SPDX-License-Identifier: Apache-2.0

import type { NodeId, VectorDocument } from '@/scene'

export type VectorEditPreviewSnapshot = Readonly<
  Record<NodeId, VectorDocument>
>

export interface VectorEditPreviewStore {
  getSnapshot: () => VectorEditPreviewSnapshot
  subscribe: (listener: () => void) => () => void
  preview: (nodeId: NodeId, vector: VectorDocument) => void
  finish: () => void
  clear: () => void
}

const EMPTY = Object.freeze({}) as VectorEditPreviewSnapshot

export function createVectorEditPreviewStore(): VectorEditPreviewStore {
  let visible = EMPTY
  const listeners = new Set<() => void>()

  const publish = (next: VectorEditPreviewSnapshot) => {
    if (visible === next) return
    visible = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => visible,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    preview: (nodeId, vector) => {
      publish({ [nodeId]: vector })
    },
    finish: () => publish(EMPTY),
    clear: () => publish(EMPTY),
  }
}

export const vectorEditPreviewStore = createVectorEditPreviewStore()
