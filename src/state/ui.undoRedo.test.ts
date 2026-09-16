// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { useUI } from './ui'

describe('undo/redo capability mirror', () => {
  it('defaults to unavailable no-ops before useKeyboardShortcuts mounts', () => {
    const state = useUI.getState()
    expect(state.canUndo).toBe(false)
    expect(state.canRedo).toBe(false)
    expect(() => state.undo()).not.toThrow()
    expect(() => state.redo()).not.toThrow()
  })

  it('setUndoRedoCapability merges a partial patch without clobbering the rest', () => {
    let undoCalls = 0
    useUI.getState().setUndoRedoCapability({ undo: () => { undoCalls += 1 } })
    useUI.getState().setUndoRedoCapability({ canUndo: true })

    const state = useUI.getState()
    expect(state.canUndo).toBe(true)
    expect(state.canRedo).toBe(false)
    state.undo()
    expect(undoCalls).toBe(1)

    // Reset for other tests sharing this module-level store.
    useUI.getState().setUndoRedoCapability({
      canUndo: false,
      canRedo: false,
      undo: () => {},
      redo: () => {},
    })
  })
})
