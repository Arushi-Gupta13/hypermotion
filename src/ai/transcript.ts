// SPDX-License-Identifier: Apache-2.0

/**
 * Turns Claude Code's `--output-format stream-json` events into a transcript
 * the assistant panel can render. Pure and synchronous so it can be tested
 * without Electron or a running model.
 */

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      inputJson: string
      status: 'running' | 'done' | 'error'
      result?: string
    }
  | { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string }

export interface TranscriptState {
  entries: TranscriptEntry[]
  /** Claude Code session id, used to continue the conversation next turn. */
  sessionId: string | null
  /** Accumulated cost of the session, in USD (informational). */
  costUsd: number
  /** `${messageId}:${blockIndex}` -> entry id for blocks still streaming. */
  blocks: Record<string, string>
  currentMessageId: string | null
}

export const emptyTranscript: TranscriptState = {
  entries: [],
  sessionId: null,
  costUsd: 0,
  blocks: {},
  currentMessageId: null,
}

const TOOL_PREFIX = 'mcp__canvas__'

export function displayToolName(name: string): string {
  return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name
}

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function replaceEntry(
  entries: TranscriptEntry[],
  id: string,
  update: (entry: TranscriptEntry) => TranscriptEntry,
): TranscriptEntry[] {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) return entries
  const next = entries.slice()
  next[index] = update(entries[index])
  return next
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part)
        return record && typeof record.text === 'string' ? record.text : ''
      })
      .join('')
  }
  return ''
}

export function addUserEntry(state: TranscriptState, id: string, text: string): TranscriptState {
  return { ...state, entries: [...state.entries, { kind: 'user', id, text }] }
}

export function addNotice(
  state: TranscriptState,
  id: string,
  tone: 'info' | 'error',
  text: string,
): TranscriptState {
  return { ...state, entries: [...state.entries, { kind: 'notice', id, tone, text }] }
}

/** Mark anything still streaming or running as finished (turn ended or stopped). */
export function settleTranscript(state: TranscriptState): TranscriptState {
  return {
    ...state,
    blocks: {},
    currentMessageId: null,
    entries: state.entries.map((entry) => {
      if (entry.kind === 'assistant' && entry.streaming) return { ...entry, streaming: false }
      if (entry.kind === 'tool' && entry.status === 'running') {
        return { ...entry, status: 'error', result: entry.result ?? 'Stopped before finishing.' }
      }
      return entry
    }),
  }
}

export function applyClaudeEvent(state: TranscriptState, raw: unknown): TranscriptState {
  const event = asRecord(raw)
  if (!event) return state

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init' && typeof event.session_id === 'string') {
        return { ...state, sessionId: event.session_id }
      }
      return state
    }
    case 'stream_event':
      return applyStreamEvent(state, asRecord(event.event))
    case 'assistant':
      return applyAssistantMessage(state, asRecord(event.message))
    case 'user':
      return applyToolResults(state, asRecord(event.message))
    case 'result': {
      const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0
      let next: TranscriptState = { ...settleTranscript(state), costUsd: cost }
      if (typeof event.session_id === 'string') next = { ...next, sessionId: event.session_id }
      if (event.is_error === true) {
        const message =
          typeof event.result === 'string' && event.result
            ? event.result
            : 'Claude stopped with an error.'
        next = addNotice(next, `result-${next.entries.length}`, 'error', message)
      }
      return next
    }
    default:
      return state
  }
}

function applyStreamEvent(state: TranscriptState, event: Json | null): TranscriptState {
  if (!event) return state
  switch (event.type) {
    case 'message_start': {
      const message = asRecord(event.message)
      return {
        ...state,
        currentMessageId: typeof message?.id === 'string' ? message.id : state.currentMessageId,
      }
    }
    case 'content_block_start': {
      const block = asRecord(event.content_block)
      const index = typeof event.index === 'number' ? event.index : 0
      const key = `${state.currentMessageId ?? 'm'}:${index}`
      if (block?.type === 'text') {
        const id = `text-${key}`
        return {
          ...state,
          blocks: { ...state.blocks, [key]: id },
          entries: [...state.entries, { kind: 'assistant', id, text: '', streaming: true }],
        }
      }
      if (block?.type === 'tool_use' && typeof block.id === 'string') {
        const id = block.id
        if (state.entries.some((entry) => entry.id === id)) return state
        return {
          ...state,
          blocks: { ...state.blocks, [key]: id },
          entries: [
            ...state.entries,
            {
              kind: 'tool',
              id,
              name: typeof block.name === 'string' ? block.name : 'tool',
              input: {},
              inputJson: '',
              status: 'running',
            },
          ],
        }
      }
      return state
    }
    case 'content_block_delta': {
      const index = typeof event.index === 'number' ? event.index : 0
      const id = state.blocks[`${state.currentMessageId ?? 'm'}:${index}`]
      const delta = asRecord(event.delta)
      if (!id || !delta) return state
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        const text = delta.text
        return {
          ...state,
          entries: replaceEntry(state.entries, id, (entry) =>
            entry.kind === 'assistant' ? { ...entry, text: entry.text + text } : entry,
          ),
        }
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const partial = delta.partial_json
        return {
          ...state,
          entries: replaceEntry(state.entries, id, (entry) =>
            entry.kind === 'tool' ? { ...entry, inputJson: entry.inputJson + partial } : entry,
          ),
        }
      }
      return state
    }
    case 'content_block_stop': {
      const index = typeof event.index === 'number' ? event.index : 0
      const key = `${state.currentMessageId ?? 'm'}:${index}`
      const id = state.blocks[key]
      if (!id) return state
      const { [key]: _closed, ...blocks } = state.blocks
      void _closed
      return {
        ...state,
        blocks,
        entries: replaceEntry(state.entries, id, (entry) => {
          if (entry.kind === 'assistant') return { ...entry, streaming: false }
          if (entry.kind === 'tool' && entry.inputJson) {
            return { ...entry, input: parseJson(entry.inputJson) }
          }
          return entry
        }),
      }
    }
    default:
      return state
  }
}

/** The complete assistant message: the source of truth for final text and tool input. */
function applyAssistantMessage(state: TranscriptState, message: Json | null): TranscriptState {
  const content = message?.content
  if (!Array.isArray(content)) return state
  let next = state
  for (const part of content) {
    const block = asRecord(part)
    if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
    const id = block.id
    if (next.entries.some((entry) => entry.id === id)) {
      next = {
        ...next,
        entries: replaceEntry(next.entries, id, (entry) =>
          entry.kind === 'tool' ? { ...entry, input: block.input ?? entry.input } : entry,
        ),
      }
    } else {
      next = {
        ...next,
        entries: [
          ...next.entries,
          {
            kind: 'tool',
            id,
            name: typeof block.name === 'string' ? block.name : 'tool',
            input: block.input ?? {},
            inputJson: '',
            status: 'running',
          },
        ],
      }
    }
  }
  return next
}

function applyToolResults(state: TranscriptState, message: Json | null): TranscriptState {
  const content = message?.content
  if (!Array.isArray(content)) return state
  let next = state
  for (const part of content) {
    const block = asRecord(part)
    if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
    const failed = block.is_error === true
    const text = resultText(block.content)
    next = {
      ...next,
      entries: replaceEntry(next.entries, block.tool_use_id, (entry) =>
        entry.kind === 'tool'
          ? { ...entry, status: failed ? 'error' : 'done', result: text }
          : entry,
      ),
    }
  }
  return next
}
