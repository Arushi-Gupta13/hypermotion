// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { handleMcpMessage, type McpBackend } from './aiMcp'

function backend(overrides: Partial<McpBackend> = {}): McpBackend {
  return {
    listTools: async () => [
      { name: 'get_scene', description: 'Read the scene', inputSchema: { type: 'object' } },
    ],
    callTool: async () => ({ text: 'ok' }),
    ...overrides,
  }
}

describe('handleMcpMessage', () => {
  it('answers initialize with tool capabilities and echoes the protocol version', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      backend(),
    )
    expect(response).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    })
  })

  it('does not reply to notifications', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      backend(),
    )
    expect(response).toBeNull()
  })

  it('lists the renderer-owned tools', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      backend(),
    )
    expect(response?.result).toEqual({
      tools: [
        { name: 'get_scene', description: 'Read the scene', inputSchema: { type: 'object' } },
      ],
    })
  })

  it('forwards tool calls with their arguments', async () => {
    const callTool = vi.fn(async () => ({ text: '{"ok":true}' }))
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'set_property', arguments: { nodeId: 'n1' } },
      },
      backend({ callTool }),
    )
    expect(callTool).toHaveBeenCalledWith('set_property', { nodeId: 'n1' })
    expect(response?.result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] })
  })

  it('reports a failing tool to the model instead of a protocol error', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'x' } },
      backend({
        callTool: async () => {
          throw new Error('Node not found')
        },
      }),
    )
    expect(response?.error).toBeUndefined()
    expect(response?.result).toEqual({
      content: [{ type: 'text', text: 'Node not found' }],
      isError: true,
    })
  })

  it('rejects unknown methods and malformed requests', async () => {
    const unknown = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'nope' }, backend())
    expect(unknown?.error?.code).toBe(-32601)
    const malformed = await handleMcpMessage('hello', backend())
    expect(malformed?.error?.code).toBe(-32600)
  })
})
