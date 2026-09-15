// SPDX-License-Identifier: Apache-2.0

import type { Fill, NodeId } from '@/scene'

export type GradientFill = Extract<Fill, { kind: 'linear' | 'radial' | 'conic' }>

export interface GradientEditTarget {
  nodeId: NodeId
  fill: GradientFill
  onCommit: (fill: Fill) => void
}

export interface GradientEditStore {
  getSnapshot: () => GradientEditTarget | null
  subscribe: (listener: () => void) => () => void
  /** Registers (or updates) the gradient currently being edited via a popover. */
  set: (token: symbol, target: GradientEditTarget) => void
  /** Clears the target, but only if it still belongs to `token`. */
  clear: (token: symbol) => void
}

export function isGradientFillKind(kind: Fill['kind']): kind is GradientFill['kind'] {
  return kind === 'linear' || kind === 'radial' || kind === 'conic'
}

export function createGradientEditStore(): GradientEditStore {
  let current: GradientEditTarget | null = null
  let owner: symbol | null = null
  const listeners = new Set<() => void>()

  const publish = () => {
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (token, target) => {
      owner = token
      current = target
      publish()
    },
    clear: (token) => {
      if (owner !== token) return
      owner = null
      current = null
      publish()
    },
  }
}

export const gradientEditStore = createGradientEditStore()
