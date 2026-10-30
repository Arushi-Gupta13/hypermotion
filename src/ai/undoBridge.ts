// SPDX-License-Identifier: Apache-2.0

import type * as Y from 'yjs'

/**
 * The scene's Y.UndoManager is created inside `useKeyboardShortcuts`. It
 * registers here so the assistant panel can revert the steps one turn added
 * without owning a second history.
 */
let manager: Y.UndoManager | null = null

export function registerSceneUndoManager(next: Y.UndoManager | null): void {
  manager = next
}

export function getSceneUndoManager(): Y.UndoManager | null {
  return manager
}

/** Number of steps currently on the undo stack (0 when unavailable). */
export function undoDepth(): number {
  return manager?.undoStack.length ?? 0
}

/** Close the current capture window so the next edit starts a new undo step. */
export function closeUndoCapture(): void {
  manager?.stopCapturing()
}

/**
 * Undo until the stack is back to `depth`. Returns how many steps were undone.
 * Stops early if the stack empties or an undo makes no progress.
 */
export function undoToDepth(depth: number): number {
  if (!manager) return 0
  let undone = 0
  while (manager.undoStack.length > depth) {
    const before = manager.undoStack.length
    manager.undo()
    if (manager.undoStack.length >= before) break
    undone += 1
  }
  return undone
}
