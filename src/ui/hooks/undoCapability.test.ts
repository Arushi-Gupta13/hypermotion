// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

/**
 * Reproduces the exact Y.UndoManager wiring in useKeyboardShortcuts.ts
 * (tracked types, tracked origins, captureTimeout) outside of React, so
 * the "canUndo never turns on after an edit" report can be verified
 * against the real Yjs behavior instead of guessed at from reading code.
 */
function buildUndoManager(api: ReturnType<typeof createSceneAPI>) {
  const scene = api.doc.getMap('scene')
  const nodesMap = scene.get('nodes') as Y.Map<unknown> | undefined
  const tracksMap = scene.get('tracks') as Y.Map<unknown> | undefined
  const uiStateMap = scene.get('uiState') as Y.Map<unknown> | undefined
  const sectionsMap = scene.get('sections') as Y.Map<unknown> | undefined
  const tracked: Y.AbstractType<unknown>[] = []
  if (nodesMap) tracked.push(nodesMap as unknown as Y.AbstractType<unknown>)
  if (tracksMap) tracked.push(tracksMap as unknown as Y.AbstractType<unknown>)
  if (uiStateMap) tracked.push(uiStateMap as unknown as Y.AbstractType<unknown>)
  if (sectionsMap) tracked.push(sectionsMap as unknown as Y.AbstractType<unknown>)
  tracked.push(scene as unknown as Y.AbstractType<unknown>)
  return new Y.UndoManager(tracked, {
    captureTimeout: 500,
    trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
  })
}

describe('undo capability wiring (reproduces useKeyboardShortcuts.ts)', () => {
  /**
   * `syncCapability` in useKeyboardShortcuts.ts previously listened only
   * to 'stack-item-added' and 'stack-item-popped'. Real usage almost
   * always involves a mutation shortly before the edit the user actually
   * cares about (creating the node itself, an earlier click-driven state
   * change, a previous edit in the same gesture) — Y.UndoManager merges
   * any edit within its 500ms captureTimeout of the previous one into the
   * SAME stack item and fires 'stack-item-updated' instead of
   * 'stack-item-added' for it. Missing that event is exactly why canUndo
   * could stay false after a real edit: the edit landed, but as an update
   * to an already-existing (unobserved) stack item, not a new one.
   */
  function trackCapability(mgr: Y.UndoManager) {
    let canUndo = mgr.undoStack.length > 0
    const sync = () => { canUndo = mgr.undoStack.length > 0 }
    mgr.on('stack-item-added', sync)
    mgr.on('stack-item-updated', sync)
    mgr.on('stack-item-popped', sync)
    return { get canUndo() { return canUndo } }
  }

  it('reflects canUndo after the very first tracked edit', () => {
    const api = createSceneAPI()
    const mgr = buildUndoManager(api)
    const nodeId = api.createNode('frame', null)
    const capability = trackCapability(mgr)

    api.doc.transact(() => {
      api.setNodeProperty(nodeId, 'transform', {
        x: 42, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1,
      })
    }, UNDOABLE_GESTURE_ORIGIN)

    expect(capability.canUndo).toBe(true)
  })

  it('a second quick edit within captureTimeout merges into the same stack item — canUndo must stay true via stack-item-updated', () => {
    const api = createSceneAPI()
    const mgr = buildUndoManager(api)
    const nodeId = api.createNode('frame', null)
    const capability = trackCapability(mgr)

    api.doc.transact(() => {
      api.setNodeProperty(nodeId, 'transform', {
        x: 10, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1,
      })
    }, UNDOABLE_GESTURE_ORIGIN)
    // Immediately after — simulates a resize-drag's multiple quick commits,
    // well within the 500ms merge window. This is the merge (update) path,
    // not the add path — reproduces the exact gap that was missed.
    api.doc.transact(() => {
      api.setNodeProperty(nodeId, 'transform', {
        x: 20, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1,
      })
    }, UNDOABLE_GESTURE_ORIGIN)

    expect(mgr.undoStack.length).toBe(1)
    expect(capability.canUndo).toBe(true)
  })

  it('setNodeProperty outside an explicit transact() still reaches the tracked scope (implicit null-origin transaction)', () => {
    const api = createSceneAPI()
    const mgr = buildUndoManager(api)
    const nodeId = api.createNode('frame', null)
    const capability = trackCapability(mgr)

    // No explicit doc.transact wrapper — mirrors how some call sites
    // (e.g. ResizeHandles.tsx) call api.setNodeProperty directly.
    api.setNodeProperty(nodeId, 'transform', {
      x: 99, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1,
    })

    expect(capability.canUndo).toBe(true)
  })

  it('undo() after an edit actually reverts the node transform', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null, {
      transform: { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    const mgr = buildUndoManager(api)
    // Force the next tracked edit to land as its own stack item rather
    // than merging with the node creation above (real captureTimeout
    // elapsing does the same thing; resetting the manager's internal
    // clock is the deterministic way to express "some time passed"
    // without depending on fake timers, which hung under this Yjs
    // version's own internal timing).
    mgr.lastChange = 0

    api.doc.transact(() => {
      api.setNodeProperty(nodeId, 'transform', {
        x: 500, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1,
      })
    }, UNDOABLE_GESTURE_ORIGIN)

    expect(api.getNode(nodeId)?.transform.x).toBe(500)
    expect(mgr.undoStack.length).toBe(1)

    mgr.undo()

    expect(api.getNode(nodeId)?.transform.x).toBe(0)
  })
})
