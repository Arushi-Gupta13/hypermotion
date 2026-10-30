// SPDX-License-Identifier: Apache-2.0

/**
 * Main-process side of the editor's AI assistant.
 *
 * The assistant is the user's own Claude Code, run headlessly:
 *
 *   panel (renderer) --ai:send--> main --spawns--> `claude -p --output-format stream-json`
 *                                                     |
 *                                                     | MCP over loopback HTTP
 *                                                     v
 *   renderer (live scene) <--ai:rpc-- main (this file's MCP endpoint)
 *
 * Claude's tool calls land on a loopback-only, token-protected endpoint. We
 * relay each one to the renderer, which runs it against the open scene and
 * answers over `ai:rpc-result`. No API key is handled here: Claude Code uses
 * the login the user already has.
 */

import { app, ipcMain, type WebContents } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  handleMcpMessage,
  type McpBackend,
  type McpToolDefinition,
  type McpToolResult,
} from './aiMcp'
import {
  CLAUDE_MODELS,
  CODEX_TOKEN_ENV,
  buildClaudeArgs,
  buildCodexArgs,
  createCodexNormalizer,
  parseCodexDefaultModel,
  parseCodexModels,
  type AiModelOption,
  type AiProvider,
} from './aiProviders'

const RPC_TIMEOUT_MS = 60_000
const STDERR_TAIL_BYTES = 4096
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_TURNS = 40

type RpcKind = 'list-tools' | 'call-tool'

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface ActiveTurn {
  child: ChildProcess
  sender: WebContents
  stopped: boolean
}

interface Bridge {
  server: http.Server
  port: number
  token: string
}

const pendingRpc = new Map<string, PendingRpc>()
const activeTurns = new Map<string, ActiveTurn>()
let bridge: Bridge | null = null
/** Renderer that owns the scene the tools act on (the one that sent the turn). */
let toolTarget: WebContents | null = null

// ---------------------------------------------------------------------------
// Locating Claude Code
// ---------------------------------------------------------------------------

function locateCli(name: string, envVar: string, extra: string[]): string | null {
  const fromEnv = process.env[envVar]?.trim()
  const candidates = [
    fromEnv,
    path.join(os.homedir(), '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...extra,
  ]
  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) return candidate
  }
  // A packaged app starts with a minimal PATH; ask the user's login shell.
  const shell = process.env.SHELL || '/bin/zsh'
  const found = spawnSync(shell, ['-lc', `command -v ${name}`], {
    encoding: 'utf8',
    timeout: 5000,
  })
  const resolved = found.stdout?.trim().split('\n').pop()?.trim()
  return resolved && isExecutable(resolved) ? resolved : null
}

export function locateClaude(): string | null {
  return locateCli('claude', 'HYPERMOTION_CLAUDE_PATH', [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
  ])
}

export function locateCodex(): string | null {
  return locateCli('codex', 'HYPERMOTION_CODEX_PATH', [])
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
}

/** Models Codex offers this account, from Codex's own cache (never auth.json). */
function readCodexModels(): { models: AiModelOption[]; defaultModel: string | null } {
  let models: AiModelOption[] = []
  let defaultModel: string | null = null
  try {
    models = parseCodexModels(
      JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8')),
    )
  } catch {
    /* no cache yet: only the default and custom entries are offered */
  }
  try {
    defaultModel = parseCodexDefaultModel(
      fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8'),
    )
  } catch {
    /* no user config */
  }
  return { models, defaultModel }
}

function cliVersion(file: string): string | null {
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 5000 })
  return result.stdout?.trim() || null
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Renderer RPC (tool list + tool calls run against the live scene)
// ---------------------------------------------------------------------------

function rendererCall(kind: RpcKind, payload: Record<string, unknown>): Promise<unknown> {
  const target = toolTarget
  if (!target || target.isDestroyed()) {
    return Promise.reject(new Error('The editor window is not available.'))
  }
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpc.delete(requestId)
      reject(new Error(`The editor did not answer "${kind}" in time.`))
    }, RPC_TIMEOUT_MS)
    pendingRpc.set(requestId, { resolve, reject, timer })
    target.send('ai:rpc', { requestId, kind, ...payload })
  })
}

const backend: McpBackend = {
  listTools: async () =>
    (await rendererCall('list-tools', {})) as McpToolDefinition[],
  callTool: async (name, args) =>
    (await rendererCall('call-tool', { name, args })) as McpToolResult,
}

// ---------------------------------------------------------------------------
// Loopback MCP endpoint
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function ensureBridge(): Promise<Bridge> {
  if (bridge) return bridge
  const token = crypto.randomBytes(32).toString('hex')
  const server = http.createServer((req, res) => {
    void handleHttp(req, res, token)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Port 0 + loopback only: never reachable from the network.
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not start the assistant bridge.')
  }
  bridge = { server, port: address.port, token }
  return bridge
}

async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
): Promise<void> {
  const reply = (status: number, body?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  // DNS-rebinding guard: only accept requests addressed to the loopback host.
  const host = (req.headers.host ?? '').split(':')[0]
  if (host !== '127.0.0.1' && host !== 'localhost') return reply(403)
  const auth = req.headers.authorization ?? ''
  if (!timingSafeEqual(auth, `Bearer ${token}`)) return reply(401)
  if (req.url !== '/mcp') return reply(404)
  if (req.method !== 'POST') return reply(405)

  let raw = ''
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return reply(413)
    raw += (chunk as Buffer).toString('utf8')
  }
  let message: unknown
  try {
    message = JSON.parse(raw)
  } catch {
    return reply(400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  }
  const response = await handleMcpMessage(message, backend)
  if (response === null) return reply(202)
  reply(200, response)
}

function stopBridgeIfIdle(): void {
  if (activeTurns.size > 0 || !bridge) return
  bridge.server.close()
  bridge = null
}

// ---------------------------------------------------------------------------
// Claude turns
// ---------------------------------------------------------------------------

export interface SendTurnRequest {
  prompt: string
  /** Which local CLI runs the turn. Defaults to Claude Code. */
  provider?: AiProvider
  /** Session (Claude) or thread (Codex) id from a previous turn of this provider. */
  sessionId?: string
  /** Empty or omitted means the CLI's own default model. */
  model?: string
  systemPrompt?: string
}

function workingDirectory(): string {
  // A neutral directory so no project CLAUDE.md or settings leak into the turn.
  const dir = path.join(app.getPath('userData'), 'ai-workdir')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function startTurn(
  sender: WebContents,
  request: SendTurnRequest,
): Promise<{ turnId: string }> {
  const provider: AiProvider = request.provider === 'codex' ? 'codex' : 'claude'
  const cli = provider === 'codex' ? locateCodex() : locateClaude()
  if (!cli) {
    throw new Error(
      provider === 'codex'
        ? 'The Codex CLI was not found. Install it (npm i -g @openai/codex), run `codex` once to sign in with ChatGPT, or set HYPERMOTION_CODEX_PATH.'
        : 'Claude Code was not found. Install it (https://claude.com/claude-code) and sign in, or set HYPERMOTION_CLAUDE_PATH.',
    )
  }
  if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
    throw new Error('Type a prompt first.')
  }
  toolTarget = sender
  const { port, token } = await ensureBridge()
  const mcpUrl = `http://127.0.0.1:${port}/mcp`
  const model = request.model?.trim() || undefined

  let args: string[]
  let prompt = request.prompt
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.dirname(cli)}${path.delimiter}${process.env.PATH ?? ''}`,
  }
  if (provider === 'codex') {
    args = buildCodexArgs({
      mcpUrl,
      sessionId: request.sessionId,
      // --ignore-user-config drops the user's default model too, so apply it explicitly.
      model: model ?? readCodexModels().defaultModel ?? undefined,
    })
    // The token travels in the environment, never on the command line.
    env[CODEX_TOKEN_ENV] = token
    // Codex has no append-system-prompt flag: brief it once, at the start of a thread.
    if (!request.sessionId && request.systemPrompt) {
      prompt = `${request.systemPrompt}\n\n---\n\n${request.prompt}`
    }
  } else {
    args = buildClaudeArgs({
      mcpUrl,
      token,
      sessionId: request.sessionId,
      model,
      systemPrompt: request.systemPrompt,
      maxTurns: MAX_TURNS,
    })
  }
  const normalizeCodex = provider === 'codex' ? createCodexNormalizer() : null

  const turnId = crypto.randomUUID()
  const child = spawn(cli, args, {
    cwd: workingDirectory(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const turn: ActiveTurn = { child, sender, stopped: false }
  activeTurns.set(turnId, turn)

  const emit = (channel: string, payload: unknown) => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  let stdoutBuffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      newline = stdoutBuffer.indexOf('\n')
      if (!line) continue
      try {
        const parsed: unknown = JSON.parse(line)
        for (const event of normalizeCodex ? normalizeCodex(parsed) : [parsed]) {
          emit('ai:event', { turnId, event })
        }
      } catch {
        // Non-JSON output (warnings) is not part of the transcript.
      }
    }
  })

  let stderrTail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
  })

  const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
    if (!activeTurns.delete(turnId)) return
    emit('ai:done', {
      turnId,
      code,
      signal,
      stopped: turn.stopped,
      stderr: spawnError ? spawnError.message : stderrTail.trim(),
    })
    stopBridgeIfIdle()
  }
  child.on('error', (error) => finish(null, null, error))
  child.on('close', (code, signal) => finish(code, signal))

  child.stdin.on('error', () => {
    /* Claude exited before reading the prompt; `close` reports why. */
  })
  child.stdin.end(prompt)
  return { turnId }
}

function stopTurn(turnId: string): boolean {
  const turn = activeTurns.get(turnId)
  if (!turn) return false
  turn.stopped = true
  turn.child.kill('SIGTERM')
  return true
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerAiAssistant(): void {
  ipcMain.handle('ai:status', () => {
    const claude = locateClaude()
    const codex = locateCodex()
    const codexModels = readCodexModels()
    return {
      claude: claude
        ? { available: true as const, path: claude, version: cliVersion(claude), models: CLAUDE_MODELS }
        : { available: false as const, models: CLAUDE_MODELS },
      codex: codex
        ? {
            available: true as const,
            path: codex,
            version: cliVersion(codex),
            models: codexModels.models,
            defaultModel: codexModels.defaultModel,
          }
        : { available: false as const, models: [] as AiModelOption[], defaultModel: null },
    }
  })

  ipcMain.handle('ai:send', async (event, request: SendTurnRequest) => {
    return startTurn(event.sender, request)
  })

  ipcMain.handle('ai:stop', (_event, turnId: string) => stopTurn(turnId))

  // Renderer answers to `ai:rpc` requests.
  ipcMain.handle(
    'ai:rpc-result',
    (
      _event,
      payload: { requestId: string; ok: boolean; value?: unknown; error?: string },
    ) => {
      const pending = pendingRpc.get(payload.requestId)
      if (!pending) return false
      pendingRpc.delete(payload.requestId)
      clearTimeout(pending.timer)
      if (payload.ok) pending.resolve(payload.value)
      else pending.reject(new Error(payload.error ?? 'Tool failed.'))
      return true
    },
  )

  app.on('before-quit', () => {
    for (const turn of activeTurns.values()) turn.child.kill('SIGTERM')
    bridge?.server.close()
  })
}
