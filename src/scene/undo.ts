// SPDX-License-Identifier: Apache-2.0

/**
 * Origin for one complete, user-visible scene gesture.
 *
 * Yjs normally coalesces nearby null-origin transactions for typing and
 * continuous drags. Relationship edits such as resizing a stagger set are
 * already committed as one transaction, so they need a hard capture boundary:
 * one gesture in, one Cmd+Z step out.
 */
export const UNDOABLE_GESTURE_ORIGIN = Symbol('undoable-scene-gesture')

/**
 * Origin for edits made by the AI assistant's tools. The scene's UndoManager
 * tracks it, so every assistant edit is a normal Cmd+Z step, and the panel can
 * undo exactly the steps a turn added.
 */
export const AI_EDIT_ORIGIN = Symbol('ai-assistant-edit')
