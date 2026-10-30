// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'
import {
  addNotice,
  addUserEntry,
  applyClaudeEvent,
  displayToolName,
  emptyTranscript,
  settleTranscript,
  type TranscriptState,
} from '@/ai/transcript'
import { closeUndoCapture, undoDepth, undoToDepth } from '@/ai/undoBridge'
import {
  diffSnapshots,
  readSceneTracks,
  type SceneChange,
  type TrackSnapshot,
} from '@/ai/sceneProbe'
import { MUTATING_TOOL_NAMES } from '@/ai/tools'
import { useUI } from '@/state/ui'

export const ASSISTANT_SYSTEM_PROMPT = `You are the motion-design assistant built into Hypermotion, a motion editor. You work ONLY through the canvas tools, which act on the user's open scene: every change appears on the canvas and timeline immediately and the user can undo it.

How to work:
- Call get_scene first. "this", "it" and "these" mean the user's current selection (listed in get_scene and in the editor-state line of their message); if nothing is selected and the request is ambiguous, say what you assumed.
- Modify existing animation instead of rebuilding it: read the layer's tracks in get_scene / get_node, then change just those keyframes. If asked to make something slower, faster, subtler or stronger, adjust the timing, distances or easing already there.
- Use animate_nodes for sequences and staggers (list targets in the order they should appear); use animate_property for precise keyframe curves. Keyframe values are absolute; end an entrance on the layer's resting value (omit "to" in animate_nodes to do this).
- Good defaults: entrances 0.4-0.8s with ease-out, exits 0.25-0.4s with ease-in, stagger 0.05-0.12s per item, subtle motion (8-40px, 0.95-1 scale) unless the user asks for drama. Never animate past the scene duration; raise it with set_scene_meta if the animation needs more time.
- Cameras are layers of kind "camera": animate their camera.* and transform.* properties for moves and zooms.
- When finished, call validate_scene and fix any problems, then call preview with play true so the user sees the result.
- Keep replies short: say what you changed (layer names, timings), not how the tools work. If a request cannot be done with the available tools, say so plainly and offer the closest alternative.`

export type AiProvider = 'claude' | 'codex'

const PROVIDER_KEY = 'hyper-motion.assistantProvider'
const MODELS_KEY = 'hyper-motion.assistantModels'

function readProvider(): AiProvider {
  try {
    return window.localStorage.getItem(PROVIDER_KEY) === 'codex' ? 'codex' : 'claude'
  } catch {
    return 'claude'
  }
}

function readModels(): Record<AiProvider, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MODELS_KEY) ?? '{}') as Partial<
      Record<AiProvider, unknown>
    >
    return {
      claude: typeof parsed.claude === 'string' ? parsed.claude : '',
      codex: typeof parsed.codex === 'string' ? parsed.codex : '',
    }
  } catch {
    return { claude: '', codex: '' }
  }
}

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
}

interface TurnReview {
  /** Undo-stack depth before the turn started. */
  depthBefore: number
  /** Undo-stack depth when the turn ended. */
  depthAfter: number
  prompt: string
  /** Layers whose animation this turn changed, taken from the scene itself. */
  changes: SceneChange[]
}

interface AssistantState {
  open: boolean
  width: number
  /** Which local CLI runs the next turn. */
  provider: AiProvider
  /** Model per provider; empty string means that CLI's default. */
  models: Record<AiProvider, string>
  /** Provider that owns the current transcript's session id. */
  sessionProvider: AiProvider | null
  /** Provider of the turn in flight. */
  turnProvider: AiProvider | null
  transcript: TranscriptState
  running: boolean
  turnId: string | null
  /** Set while a turn is running: where to undo back to. */
  turnBaseline: {
    depthBefore: number
    prompt: string
    tracksBefore: TrackSnapshot | null
    entriesBefore: number
  } | null
  /** Set after a turn that changed the scene, until the user decides. */
  review: TurnReview | null
  setOpen: (open: boolean) => void
  toggle: () => void
  setWidth: (width: number) => void
  setProvider: (provider: AiProvider) => void
  setModel: (model: string) => void
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
  provider: readProvider(),
  models: readModels(),
  sessionProvider: null,
  turnProvider: null,
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

  setProvider: (provider) => {
    try {
      window.localStorage.setItem(PROVIDER_KEY, provider)
    } catch {
      /* storage unavailable */
    }
    set({ provider })
  },

  setModel: (model) => {
    const { provider, models } = get()
    const next = { ...models, [provider]: model.trim() }
    try {
      window.localStorage.setItem(MODELS_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
    set({ models: next })
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
    const { provider, models, sessionProvider } = get()
    // A session id only means something to the CLI that created it. After a
    // provider switch the new one starts fresh: it cannot see the earlier chat,
    // but it reads the scene itself, so it can still carry on the work.
    const switched = sessionProvider !== null && sessionProvider !== provider
    set((s) => {
      let transcript = s.transcript
      if (switched) {
        transcript = addNotice(
          transcript,
          nextId('notice'),
          'info',
          `Switched to ${PROVIDER_LABELS[provider]}. It starts a fresh conversation and cannot see the chat above, but it reads the scene.`,
        )
      }
      return {
        running: true,
        review: null,
        turnProvider: provider,
        turnBaseline: {
          depthBefore,
          prompt,
          tracksBefore: readSceneTracks(),
          entriesBefore: transcript.entries.length,
        },
        transcript: addUserEntry(transcript, nextId('user'), prompt),
      }
    })
    try {
      const { turnId } = (await bridge.invoke('ai:send', {
        prompt: selectionNote ? `${selectionNote}\n\n${prompt}` : prompt,
        provider,
        model: models[provider] || undefined,
        sessionId: switched ? undefined : (get().transcript.sessionId ?? undefined),
        systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      })) as { turnId: string }
      set({ turnId })
    } catch (error) {
      set((s) => ({
        running: false,
        turnProvider: null,
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
    set({ transcript: emptyTranscript, review: null, turnBaseline: null, sessionProvider: null })
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
    const tracksAfter = readSceneTracks()
    const changes =
      baseline?.tracksBefore && tracksAfter ? diffSnapshots(baseline.tracksBefore, tracksAfter) : []
    const changed = baseline !== null && (depthAfter > baseline.depthBefore || changes.length > 0)
    // Show the user what changed: select the layers whose animation was edited.
    const present = changes.filter((change) => change.present).map((change) => change.nodeId)
    if (present.length > 0) useUI.getState().setSelection(present)
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
      } else if (baseline && !changed) {
        // The model said it edited the scene but the scene is unchanged: say so,
        // rather than letting the user assume something happened.
        const tried = transcript.entries
          .slice(baseline.entriesBefore)
          .some(
            (entry) =>
              entry.kind === 'tool' &&
              entry.status === 'done' &&
              MUTATING_TOOL_NAMES.has(displayToolName(entry.name)),
          )
        if (tried) {
          transcript = addNotice(
            transcript,
            nextId('notice'),
            'info',
            'The assistant ran edit tools, but nothing in the scene changed.',
          )
        }
      }
      return {
        running: false,
        turnId: null,
        turnBaseline: null,
        turnProvider: null,
        sessionProvider: s.turnProvider ?? s.sessionProvider,
        transcript,
        review:
          changed && baseline
            ? { depthBefore: baseline.depthBefore, depthAfter, prompt: baseline.prompt, changes }
            : null,
      }
    })
  },
}))
