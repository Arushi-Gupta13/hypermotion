// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  addUserEntry,
  applyClaudeEvent,
  displayToolName,
  emptyTranscript,
  settleTranscript,
  type TranscriptState,
} from '@/ai/transcript'

const stream = (event: unknown) => ({ type: 'stream_event', event })

function run(events: unknown[], from: TranscriptState = emptyTranscript) {
  return events.reduce<TranscriptState>((state, event) => applyClaudeEvent(state, event), from)
}

describe('applyClaudeEvent', () => {
  it('captures the session id from init', () => {
    const state = run([{ type: 'system', subtype: 'init', session_id: 'abc' }])
    expect(state.sessionId).toBe('abc')
  })

  it('streams assistant text into one entry and finishes it', () => {
    const state = run([
      stream({ type: 'message_start', message: { id: 'm1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    ])
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true })

    const done = applyClaudeEvent(state, stream({ type: 'content_block_stop', index: 0 }))
    expect(done.entries[0]).toMatchObject({ streaming: false })
  })

  it('assembles streamed tool input and resolves it from the tool result', () => {
    const state = run([
      stream({ type: 'message_start', message: { id: 'm2' } }),
      stream({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'mcp__canvas__animate_nodes' },
      }),
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"targets":' },
      }),
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '["a"]}' },
      }),
      stream({ type: 'content_block_stop', index: 0 }),
    ])
    expect(state.entries[0]).toMatchObject({
      kind: 'tool',
      status: 'running',
      input: { targets: ['a'] },
    })

    const resolved = applyClaudeEvent(state, {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"ok":true}' }] }],
      },
    })
    expect(resolved.entries[0]).toMatchObject({ status: 'done', result: '{"ok":true}' })
  })

  it('marks a failed tool result as an error', () => {
    const state = run([
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't9', name: 'x', input: { a: 1 } }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't9', is_error: true, content: 'No node' }] },
      },
    ])
    expect(state.entries[0]).toMatchObject({ status: 'error', result: 'No node', input: { a: 1 } })
  })

  it('does not duplicate a tool entry when the full message follows the stream', () => {
    const state = run([
      stream({ type: 'message_start', message: { id: 'm3' } }),
      stream({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't2', name: 'x' },
      }),
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'x', input: { b: 2 } }] } },
    ])
    expect(state.entries.filter((e) => e.kind === 'tool')).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ input: { b: 2 } })
  })

  it('records cost and surfaces an error result', () => {
    const state = run([
      { type: 'result', subtype: 'success', is_error: true, result: 'Credit balance too low', total_cost_usd: 0.02, session_id: 's' },
    ])
    expect(state.costUsd).toBe(0.02)
    expect(state.sessionId).toBe('s')
    expect(state.entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'Credit balance too low' })
  })

  it('ignores events it does not understand', () => {
    expect(run([{ type: 'rate_limit_event' }, 'junk', null])).toEqual(emptyTranscript)
  })
})

describe('settleTranscript', () => {
  it('closes streaming text and running tools when a turn is stopped', () => {
    const streaming = run([
      stream({ type: 'message_start', message: { id: 'm4' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'x', input: {} }] } },
    ])
    const settled = settleTranscript(addUserEntry(streaming, 'u', 'hi'))
    const assistant = settled.entries.find((e) => e.kind === 'assistant')
    const tool = settled.entries.find((e) => e.kind === 'tool')
    expect(assistant).toMatchObject({ streaming: false })
    expect(tool).toMatchObject({ status: 'error', result: 'Stopped before finishing.' })
  })
})

describe('displayToolName', () => {
  it('drops the MCP prefix', () => {
    expect(displayToolName('mcp__canvas__get_scene')).toBe('get_scene')
    expect(displayToolName('other')).toBe('other')
  })
})
