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

const MCP_SERVER_NAME = 'canvas'
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

export function locateClaude(): string | null {
  const fromEnv = process.env.HYPERMOTION_CLAUDE_PATH?.trim()
  const candidates = [
    fromEnv,
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.claude', 'local', 'claude'),
  ]
  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) return candidate
  }
  // A packaged app starts with a minimal PATH; ask the user's login shell.
  const shell = process.env.SHELL || '/bin/zsh'
  const found = spawnSync(shell, ['-lc', 'command -v claude'], {
    encoding: 'utf8',
    timeout: 5000,
  })
  const resolved = found.stdout?.trim().split('\n').pop()?.trim()
  return resolved && isExecutable(resolved) ? resolved : null
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
  /** Claude Code session id from a previous turn; continues the conversation. */
  sessionId?: string
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
  const claude = locateClaude()
  if (!claude) {
    throw new Error(
      'Claude Code was not found. Install it (https://claude.com/claude-code) and sign in, or set HYPERMOTION_CLAUDE_PATH.',
    )
  }
  if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
    throw new Error('Type a prompt first.')
  }
  toolTarget = sender
  const { port, token } = await ensureBridge()
  const mcpConfig = JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  })
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config',
    mcpConfig,
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
    String(MAX_TURNS),
  ]
  if (request.sessionId) args.push('--resume', request.sessionId)
  if (request.model) args.push('--model', request.model)
  if (request.systemPrompt) args.push('--append-system-prompt', request.systemPrompt)

  const turnId = crypto.randomUUID()
  const child = spawn(claude, args, {
    cwd: workingDirectory(),
    env: {
      ...process.env,
      PATH: `${path.dirname(claude)}${path.delimiter}${process.env.PATH ?? ''}`,
    },
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
        emit('ai:event', { turnId, event: JSON.parse(line) })
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
  child.stdin.end(request.prompt)
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
    if (!claude) return { available: false as const }
    const version = spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 5000 })
    return {
      available: true as const,
      path: claude,
      version: version.stdout?.trim() || null,
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
