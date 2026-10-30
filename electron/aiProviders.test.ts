// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  buildClaudeArgs,
  buildCodexArgs,
  createCodexNormalizer,
  parseCodexDefaultModel,
  parseCodexModels,
} from './aiProviders'
import { applyClaudeEvent, emptyTranscript, type TranscriptState } from '../src/ai/transcript'

describe('buildClaudeArgs', () => {
  const base = { mcpUrl: 'http://127.0.0.1:5000/mcp', token: 't0k', maxTurns: 40 }

  it('keeps the isolation flags that were verified against a real run', () => {
    const args = buildClaudeArgs(base)
    expect(args.slice(0, 5)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'])
    expect(args).toContain('--strict-mcp-config')
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--disable-slash-commands')
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual([
      '--setting-sources',
      'project',
    ])
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(config.mcpServers.canvas).toEqual({
      type: 'http',
      url: base.mcpUrl,
      headers: { Authorization: 'Bearer t0k' },
    })
  })

  it('adds resume, model and system prompt only when given', () => {
    expect(buildClaudeArgs(base)).not.toContain('--resume')
    const args = buildClaudeArgs({ ...base, sessionId: 's1', model: 'claude-opus-5-5', systemPrompt: 'be brief' })
    expect(args).toEqual(expect.arrayContaining(['--resume', 's1', '--model', 'claude-opus-5-5', '--append-system-prompt', 'be brief']))
  })
})

describe('buildCodexArgs', () => {
  const base = { mcpUrl: 'http://127.0.0.1:5000/mcp' }

  it('reads the prompt from stdin and never puts the token on the command line', () => {
    const args = buildCodexArgs(base)
    expect(args[0]).toBe('exec')
    expect(args.at(-1)).toBe('-')
    expect(args.join(' ')).not.toMatch(/Bearer|t0k/)
    expect(args).toContain('mcp_servers.canvas.bearer_token_env_var="HM_CANVAS_TOKEN"')
    expect(args).toContain('mcp_servers.canvas.url="http://127.0.0.1:5000/mcp"')
  })

  it('locks down built-in tools and ignores user config', () => {
    const args = buildCodexArgs(base)
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('sandbox_mode="read-only"')
    expect(args).toContain('approval_policy="never"')
    for (const feature of ['shell_tool', 'unified_exec', 'plugins', 'browser_use']) {
      const index = args.indexOf(feature)
      expect(index).toBeGreaterThan(0)
      expect(args[index - 1]).toBe('--disable')
    }
  })

  it('resumes a thread and selects a model', () => {
    const args = buildCodexArgs({ ...base, sessionId: 'thread-1', model: 'gpt-5.6-terra' })
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-1'])
    expect(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2)).toEqual(['-m', 'gpt-5.6-terra'])
  })
})

describe('Codex model discovery', () => {
  it('lists visible models and skips hidden ones', () => {
    const models = parseCodexModels({
      models: [
        { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
        { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide' },
        { slug: 'plain' },
        'junk',
      ],
    })
    expect(models).toEqual([
      { id: 'gpt-6-luna', label: 'GPT-6-Luna' },
      { id: 'plain', label: 'plain' },
    ])
    expect(parseCodexModels(null)).toEqual([])
  })

  it('reads the default model from the top level of config.toml only', () => {
    expect(parseCodexDefaultModel('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\n')).toBe('gpt-5.6-terra')
    expect(parseCodexDefaultModel('[profiles.x]\nmodel = "other"\n')).toBeNull()
    expect(parseCodexDefaultModel('')).toBeNull()
  })
})

describe('createCodexNormalizer (documented exec --json shapes)', () => {
  const run = (events: unknown[]): TranscriptState => {
    const normalize = createCodexNormalizer()
    return events
      .flatMap((event) => normalize(event))
      .reduce<TranscriptState>((state, event) => applyClaudeEvent(state, event), emptyTranscript)
  }

  it('maps a thread, an MCP tool call and a final message onto the transcript', () => {
    const state = run([
      { type: 'thread.started', thread_id: 'th-1' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { id: 'i1', type: 'mcp_tool_call', server: 'canvas', tool: 'get_scene', arguments: {}, status: 'in_progress' },
      },
      {
        type: 'item.completed',
        item: {
          id: 'i1',
          type: 'mcp_tool_call',
          server: 'canvas',
          tool: 'get_scene',
          arguments: {},
          status: 'completed',
          result: { content: [{ type: 'text', text: '{"nodes":[]}' }] },
        },
      },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Done.' } },
      { type: 'turn.completed', usage: { input_tokens: 1 } },
    ])
    expect(state.sessionId).toBe('th-1')
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0]).toMatchObject({
      kind: 'tool',
      name: 'mcp__canvas__get_scene',
      status: 'done',
      result: '{"nodes":[]}',
    })
    expect(state.entries[1]).toMatchObject({ kind: 'assistant', text: 'Done.', streaming: false })
  })

  it('marks a failed tool call and surfaces its message', () => {
    const state = run([
      {
        type: 'item.completed',
        item: { id: 'i3', type: 'mcp_tool_call', tool: 'animate_nodes', arguments: { a: 1 }, status: 'failed', error: { message: 'No node' } },
      },
    ])
    expect(state.entries[0]).toMatchObject({ kind: 'tool', status: 'error', result: 'No node', input: { a: 1 } })
  })

  it('shows any shell command Codex tries to run, so it is never hidden', () => {
    const state = run([
      { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: 'x', exit_code: 0 } },
    ])
    expect(state.entries[0]).toMatchObject({ kind: 'tool', name: 'shell', input: { command: 'ls' } })
  })

  it('turns a failed turn into one error notice (the usage-limit case)', () => {
    const state = run([
      { type: 'thread.started', thread_id: 'th-2' },
      { type: 'turn.started' },
      { type: 'error', message: 'You have hit your usage limit.' },
      { type: 'turn.failed', error: { message: 'You have hit your usage limit.' } },
    ])
    const notices = state.entries.filter((entry) => entry.kind === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ tone: 'error', text: 'You have hit your usage limit.' })
  })

  it('ignores reasoning and unknown events', () => {
    expect(run([{ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'hm' } }, { type: 'whatever' }, 5]).entries).toEqual([])
  })
})
