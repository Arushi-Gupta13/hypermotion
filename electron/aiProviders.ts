// SPDX-License-Identifier: Apache-2.0

/**
 * Provider-specific pieces of the AI assistant: how to launch each local CLI,
 * which models it offers, and how to turn its output into the transcript
 * events the panel already understands. Pure functions, so they can be tested
 * without Electron or a signed-in CLI.
 */

export type AiProvider = 'claude' | 'codex'

export interface AiModelOption {
  /** Value passed to the CLI's --model flag. Empty means "the CLI's default". */
  id: string
  label: string
}

export const MCP_SERVER_NAME = 'canvas'
export const CODEX_TOKEN_ENV = 'HM_CANVAS_TOKEN'

/** Claude Code accepts these ids directly; "Custom" in the UI covers anything else. */
export const CLAUDE_MODELS: AiModelOption[] = [
  { id: '', label: 'Default' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
]

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

export interface ClaudeArgsInput {
  mcpUrl: string
  token: string
  sessionId?: string
  model?: string
  systemPrompt?: string
  maxTurns: number
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config',
    JSON.stringify({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: input.mcpUrl,
          headers: { Authorization: `Bearer ${input.token}` },
        },
      },
    }),
    '--strict-mcp-config',
    // No shell, file or web tools: the only tools are the live-canvas ones.
    '--tools',
    '',
    '--allowedTools',
    `mcp__${MCP_SERVER_NAME}`,
    // Keep the user's personal hooks, plugins and skills out of this session:
    // faster, cheaper, and nothing unrelated can act on the canvas.
    '--setting-sources',
    'project',
    '--disable-slash-commands',
    '--max-turns',
    String(input.maxTurns),
  ]
  if (input.sessionId) args.push('--resume', input.sessionId)
  if (input.model) args.push('--model', input.model)
  if (input.systemPrompt) args.push('--append-system-prompt', input.systemPrompt)
  return args
}

// ---------------------------------------------------------------------------
// Codex CLI (ChatGPT sign-in)
// ---------------------------------------------------------------------------

/**
 * Codex has no single "no built-in tools" switch, so every tool that can touch
 * the machine or the network is turned off individually. The read-only sandbox
 * stays on as a backstop.
 */
const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'plugins',
  'image_generation',
  'view_image',
  'multi_agent',
  'hooks',
]

export interface CodexArgsInput {
  mcpUrl: string
  /** Thread id from a previous turn; continues the conversation. */
  sessionId?: string
  model?: string
}

export function buildCodexArgs(input: CodexArgsInput): string[] {
  const flags = [
    '--json',
    '--skip-git-repo-check',
    // Auth still comes from CODEX_HOME; only the user's config.toml (their MCP
    // servers, hooks, profiles) and exec-policy rules are left out.
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    '-c',
    'web_search="disabled"',
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.url=${JSON.stringify(input.mcpUrl)}`,
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var=${JSON.stringify(CODEX_TOKEN_ENV)}`,
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
  ]
  if (input.model) flags.push('-m', input.model)
  // `-` reads the prompt from stdin.
  return input.sessionId
    ? ['exec', 'resume', input.sessionId, ...flags, '-']
    : ['exec', ...flags, '-']
}

/** Models Codex marks as selectable, read from its own cache file's JSON. */
export function parseCodexModels(raw: unknown): AiModelOption[] {
  const list =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { models?: unknown }).models)
      ? ((raw as { models: unknown[] }).models)
      : []
  const options: AiModelOption[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const model = entry as Record<string, unknown>
    const slug = typeof model.slug === 'string' ? model.slug : typeof model.id === 'string' ? model.id : ''
    if (!slug || model.visibility === 'hide') continue
    options.push({
      id: slug,
      label: typeof model.display_name === 'string' && model.display_name ? model.display_name : slug,
    })
  }
  return options
}

/** `model = "..."` from the top level of a Codex config.toml, if present. */
export function parseCodexDefaultModel(toml: string): string | null {
  for (const line of toml.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) return null // first table ends the top level
    const match = /^model\s*=\s*"([^"]+)"/.exec(trimmed)
    if (match) return match[1]
  }
  return null
}

// ---------------------------------------------------------------------------
// Codex -> transcript events
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null

/** Text of an MCP tool result (`{ content: [{ type: 'text', text }] }`) or a plain string. */
function mcpResultText(result: unknown): string {
  if (typeof result === 'string') return result
  const record = asRecord(result)
  const content = record?.content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const piece = asRecord(part)
        return piece && typeof piece.text === 'string' ? piece.text : ''
      })
      .join('')
  }
  if (record?.structured_content !== undefined) return JSON.stringify(record.structured_content)
  return result === undefined || result === null ? '' : JSON.stringify(result)
}

/**
 * Translate Codex `exec --json` events into the Claude-shaped events the
 * transcript reducer consumes, so the panel needs no provider-specific code.
 * Based on Codex's documented item types (`agent_message`, `mcp_tool_call`,
 * `command_execution`, ...).
 */
export function createCodexNormalizer(): (event: unknown) => unknown[] {
  let threadId: string | null = null
  return (raw) => {
    const event = asRecord(raw)
    if (!event) return []
    switch (event.type) {
      case 'thread.started': {
        threadId = typeof event.thread_id === 'string' ? event.thread_id : null
        return threadId ? [{ type: 'system', subtype: 'init', session_id: threadId }] : []
      }
      case 'item.started': {
        const item = asRecord(event.item)
        if (!item || typeof item.id !== 'string') return []
        if (item.type === 'mcp_tool_call') return [toolUse(item.id, mcpToolName(item), item.arguments)]
        if (item.type === 'command_execution') {
          return [toolUse(item.id, 'shell', { command: item.command })]
        }
        return []
      }
      case 'item.completed': {
        const item = asRecord(event.item)
        if (!item || typeof item.id !== 'string') return []
        switch (item.type) {
          case 'agent_message':
            return typeof item.text === 'string' && item.text ? textBlock(item.id, item.text) : []
          case 'mcp_tool_call': {
            const failed = item.status === 'failed' || asRecord(item.error) !== null
            const errorMessage = asRecord(item.error)?.message
            return [
              // A call that completes without a start event still needs its row.
              toolUse(item.id, mcpToolName(item), item.arguments),
              toolResult(
                item.id,
                failed,
                typeof errorMessage === 'string' ? errorMessage : mcpResultText(item.result),
              ),
            ]
          }
          case 'command_execution':
            return [
              toolUse(item.id, 'shell', { command: item.command }),
              toolResult(
                item.id,
                typeof item.exit_code === 'number' && item.exit_code !== 0,
                typeof item.aggregated_output === 'string' ? item.aggregated_output : '',
              ),
            ]
          default:
            return []
        }
      }
      case 'turn.completed':
        return [{ type: 'result', subtype: 'success', is_error: false, session_id: threadId }]
      case 'turn.failed': {
        const message = asRecord(event.error)?.message
        return [
          {
            type: 'result',
            subtype: 'error',
            is_error: true,
            result: typeof message === 'string' && message ? message : 'Codex stopped with an error.',
            session_id: threadId,
          },
        ]
      }
      default:
        return []
    }
  }
}

function mcpToolName(item: Json): string {
  const tool = typeof item.tool === 'string' ? item.tool : 'tool'
  return `mcp__${MCP_SERVER_NAME}__${tool}`
}

function toolUse(id: string, name: string, input: unknown): unknown {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input: input ?? {} }] },
  }
}

function toolResult(id: string, isError: boolean, text: string): unknown {
  return {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text }] },
      ],
    },
  }
}

/** A finished message, expressed as the stream events the reducer renders as text. */
function textBlock(id: string, text: string): unknown[] {
  return [
    { type: 'stream_event', event: { type: 'message_start', message: { id } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
  ]
}
