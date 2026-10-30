// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'
import {
  addNotice,
  addUserEntry,
  applyClaudeEvent,
  emptyTranscript,
  settleTranscript,
  type TranscriptState,
} from '@/ai/transcript'
import { closeUndoCapture, undoDepth, undoToDepth } from '@/ai/undoBridge'

export const ASSISTANT_SYSTEM_PROMPT = `You are the motion-design assistant built into Hypermotion, a motion editor. You work ONLY through the canvas tools, which act on the user's open scene: every change appears on the canvas and timeline immediately and the user can undo it.

How to work:
- Call get_scene first. "this", "it" and "these" mean the user's current selection (listed in get_scene and in the editor-state line of their message); if nothing is selected and the request is ambiguous, say what you assumed.
- Modify existing animation instead of rebuilding it: read the layer's tracks in get_scene / get_node, then change just those keyframes. If asked to make something slower, faster, subtler or stronger, adjust the timing, distances or easing already there.
- Use animate_nodes for sequences and staggers (list targets in the order they should appear); use animate_property for precise keyframe curves. Keyframe values are absolute; end an entrance on the layer's resting value (omit "to" in animate_nodes to do this).
- Good defaults: entrances 0.4-0.8s with ease-out, exits 0.25-0.4s with ease-in, stagger 0.05-0.12s per item, subtle motion (8-40px, 0.95-1 scale) unless the user asks for drama. Never animate past the scene duration; raise it with set_scene_meta if the animation needs more time.
- Cameras are layers of kind "camera": animate their camera.* and transform.* properties for moves and zooms.
- When finished, call validate_scene and fix any problems, then call preview with play true so the user sees the result.
- Keep replies short: say what you changed (layer names, timings), not how the tools work. If a request cannot be done with the available tools, say so plainly and offer the closest alternative.`

interface TurnReview {
  /** Undo-stack depth before the turn started. */
  depthBefore: number
  /** Undo-stack depth when the turn ended. */
  depthAfter: number
  prompt: string
}

interface AssistantState {
  open: boolean
  width: number
  transcript: TranscriptState
  running: boolean
  turnId: string | null
  /** Set while a turn is running: where to undo back to. */
  turnBaseline: { depthBefore: number; prompt: string } | null
  /** Set after a turn that changed the scene, until the user decides. */
  review: TurnReview | null
  setOpen: (open: boolean) => void
  toggle: () => void
  setWidth: (width: number) => void
  send: (text: string, selectionNote?: string) => Promise<void>
  stop: () => Promise<void>
  keep: () => void
  revert: () => void
  tryAgain: () => Promise<void>
  clear: () => void
  onClaudeEvent: (turnId: string, event: unknown) => void
  onTurnDone: (payload: {
    turnId: string
    code: number | null
    stopped: boolean
    stderr: string
  }) => void
}

const WIDTH_KEY = 'hyper-motion.assistantWidth'

function readWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(stored) && stored >= 300 && stored <= 720) return stored
  } catch {
    /* storage unavailable */
  }
  return 400
}

let entryCounter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${entryCounter++}`

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  width: readWidth(),
  transcript: emptyTranscript,
  running: false,
  turnId: null,
  turnBaseline: null,
  review: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setWidth: (width) => {
    const next = Math.max(300, Math.min(720, Math.round(width)))
    try {
      window.localStorage.setItem(WIDTH_KEY, String(next))
    } catch {
      /* storage unavailable */
    }
    set({ width: next })
  },

  send: async (text, selectionNote) => {
    const prompt = text.trim()
    const bridge = window.hypermotion
    if (!prompt || get().running) return
    if (!bridge) {
      set((s) => ({
        transcript: addNotice(
          s.transcript,
          nextId('notice'),
          'error',
          'The assistant needs the desktop app.',
        ),
      }))
      return
    }
    // A new turn ends the previous review: the user chose to keep going.
    closeUndoCapture()
    const depthBefore = undoDepth()
    set((s) => ({
      running: true,
      review: null,
      turnBaseline: { depthBefore, prompt },
      transcript: addUserEntry(s.transcript, nextId('user'), prompt),
    }))
    try {
      const { turnId } = (await bridge.invoke('ai:send', {
        prompt: selectionNote ? `${selectionNote}\n\n${prompt}` : prompt,
        sessionId: get().transcript.sessionId ?? undefined,
        systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      })) as { turnId: string }
      set({ turnId })
    } catch (error) {
      set((s) => ({
        running: false,
        turnBaseline: null,
        transcript: addNotice(
          s.transcript,
          nextId('notice'),
          'error',
          error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error),
        ),
      }))
    }
  },

  stop: async () => {
    const { turnId } = get()
    if (turnId) await window.hypermotion?.invoke('ai:stop', turnId)
  },

  keep: () => set({ review: null }),

  revert: () => {
    const { review } = get()
    if (!review) return
    const stackNow = undoDepth()
    // Only undo what this turn added. If the user has edited since, undoing
    // the whole way back would also remove their work, so say so instead.
    if (stackNow !== review.depthAfter) {
      set((s) => ({
        review: null,
        transcript: addNotice(
          s.transcript,
          nextId('notice'),
          'info',
          'The scene changed after this turn, so it cannot be reverted automatically. Use Cmd+Z to step back.',
        ),
      }))
      return
    }
    const undone = undoToDepth(review.depthBefore)
    set((s) => ({
      review: null,
      transcript: addNotice(
        s.transcript,
        nextId('notice'),
        'info',
        `Reverted ${undone} change${undone === 1 ? '' : 's'}.`,
      ),
    }))
  },

  tryAgain: async () => {
    const { review } = get()
    if (!review) return
    const prompt = review.prompt
    get().revert()
    await get().send(prompt)
  },

  clear: () => {
    if (get().running) return
    set({ transcript: emptyTranscript, review: null, turnBaseline: null })
  },

  onClaudeEvent: (turnId, event) => {
    if (get().turnId !== turnId) return
    set((s) => ({ transcript: applyClaudeEvent(s.transcript, event) }))
  },

  onTurnDone: ({ turnId, code, stopped, stderr }) => {
    if (get().turnId !== turnId) return
    closeUndoCapture()
    const baseline = get().turnBaseline
    const depthAfter = undoDepth()
    set((s) => {
      let transcript = settleTranscript(s.transcript)
      if (stopped) {
        transcript = addNotice(transcript, nextId('notice'), 'info', 'Stopped.')
      } else if (code !== 0 && !transcript.entries.some((e) => e.kind === 'notice' && e.tone === 'error')) {
        transcript = addNotice(
          transcript,
          nextId('notice'),
          'error',
          stderr || `Claude Code exited with code ${code ?? 'unknown'}.`,
        )
      }
      const changed = baseline !== null && depthAfter > baseline.depthBefore
      return {
        running: false,
        turnId: null,
        turnBaseline: null,
        transcript,
        review:
          changed && baseline
            ? { depthBefore: baseline.depthBefore, depthAfter, prompt: baseline.prompt }
            : null,
      }
    })
  },
}))
