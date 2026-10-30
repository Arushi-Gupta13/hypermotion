// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal Model Context Protocol endpoint (Streamable HTTP, JSON responses).
 *
 * Claude Code connects to this while the editor's assistant panel runs a
 * turn. It only speaks the four calls Claude Code needs for tools:
 * `initialize`, `notifications/initialized`, `ping`, `tools/list` and
 * `tools/call`. The tool definitions and their handlers live in the
 * renderer (they act on the live scene), so this module just forwards.
 */

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  text: string
  isError?: boolean
}

export interface McpBackend {
  listTools: () => Promise<McpToolDefinition[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

const SERVER_INFO = { name: 'hypermotion-canvas', version: '1.0.0' }
const FALLBACK_PROTOCOL_VERSION = '2025-03-26'

function failure(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/**
 * Handle one JSON-RPC message. Returns `null` for notifications, which must
 * not get a response body (the HTTP layer answers 202).
 */
export async function handleMcpMessage(
  message: unknown,
  backend: McpBackend,
): Promise<JsonRpcResponse | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return failure(null, -32600, 'Invalid request')
  }
  const request = message as JsonRpcRequest
  const hasId = request.id !== undefined && request.id !== null
  const id = hasId ? (request.id as string | number) : null
  if (typeof request.method !== 'string') {
    return failure(id, -32600, 'Invalid request')
  }
  // Notifications carry no id and expect no reply.
  if (!hasId) return null

  switch (request.method) {
    case 'initialize': {
      const requested = request.params?.protocolVersion
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion:
            typeof requested === 'string' ? requested : FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list': {
      try {
        return { jsonrpc: '2.0', id, result: { tools: await backend.listTools() } }
      } catch (error) {
        return failure(id, -32603, errorMessage(error))
      }
    }
    case 'tools/call': {
      const name = request.params?.name
      const args = request.params?.arguments
      if (typeof name !== 'string') {
        return failure(id, -32602, 'tools/call requires a tool name')
      }
      const safeArgs =
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {}
      try {
        const result = await backend.callTool(name, safeArgs)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result.text }],
            ...(result.isError ? { isError: true } : {}),
          },
        }
      } catch (error) {
        // Tool failures are reported to the model, not as protocol errors, so
        // it can read the message and correct itself.
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: errorMessage(error) }],
            isError: true,
          },
        }
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${request.method}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
