// SPDX-License-Identifier: Apache-2.0

/// <reference types="node" />

/**
 * Opt-in end-to-end check: real Claude Code, the real loopback MCP bridge and
 * the real live-scene tools, run against the app's sample scene. It spends real
 * model usage, so it only runs when HYPERMOTION_E2E_CLAUDE=1 is set:
 *
 *   HYPERMOTION_E2E_CLAUDE=1 HYPERMOTION_E2E_OUT=/tmp/e2e.json \
 *     pnpm exec vitest run src/ai/assistant.e2e.test.ts
 *
 * HYPERMOTION_E2E_PROMPTS (JSON array of strings) overrides the prompt list.
 * Prompts run in order on ONE session, so later ones act as follow-ups; prefix
 * a prompt with "!" to start it in a fresh scene and session instead.
 */

import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleMcpMessage } from '../../electron/aiMcp'
import { buildClaudeArgs } from '../../electron/aiProviders'
import { createSceneAPI } from '@/scene/doc'
import { createSampleScene } from '@/scene/sample'
import { ASSISTANT_SYSTEM_PROMPT } from '@/ai/store'
import { listAiToolDefinitions, runAiTool } from '@/ai/tools'
import { diffSnapshots, snapshotTracks } from '@/ai/sceneProbe'
import { applyClaudeEvent, displayToolName, emptyTranscript, type TranscriptState } from '@/ai/transcript'

const enabled = process.env.HYPERMOTION_E2E_CLAUDE === '1'
const claude = path.join(os.homedir(), '.local', 'bin', 'claude')

const DEFAULT_PROMPTS = [
  '!Create a cinematic entrance animation for this dashboard.',
  'Make the entire animation feel more premium and cinematic.',
  'Increase the stagger between these elements.',
  '!Make the camera zoom into the selected component.',
  '!Make these elements animate in sequentially with a slight 3D rotation.',
  '!Add a glowing border beam that travels around the frame.',
]

function newScene() {
  const api = createSceneAPI()
  createSampleScene(api)
  return api
}

function selectionNote(api: ReturnType<typeof newScene>, selection: string[]): string {
  const names = selection.map((id) => {
    const node = api.getNode(id)
    return node ? `"${node.name}" (${node.kind}, id ${id})` : null
  })
  return [
    '[Editor state]',
    names.length ? `Selected layers: ${names.filter(Boolean).join(', ')}.` : 'Nothing is selected.',
    'Playhead: 0.00s.',
  ].join(' ')
}

describe.skipIf(!enabled)('assistant end to end (real Claude, real tools)', () => {
  it(
    'turns varied descriptions into scene changes',
    async () => {
      const prompts: string[] = process.env.HYPERMOTION_E2E_PROMPTS
        ? JSON.parse(process.env.HYPERMOTION_E2E_PROMPTS)
        : DEFAULT_PROMPTS
      let api = newScene()
      let selection: string[] = []
      const token = crypto.randomBytes(16).toString('hex')
      let toolLog: { name: string; error: boolean; text: string }[] = []
      const context = () => ({
        api,
        getSelection: () => selection,
        setSelection: (ids: string[]) => {
          selection = ids
        },
        getPlayhead: () => 0,
        setPlayhead: () => {},
        setPlaying: () => {},
      })
      const server = http.createServer(async (req, res) => {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401)
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        let raw = ''
        for await (const chunk of req) raw += chunk
        const out = await handleMcpMessage(JSON.parse(raw), {
          listTools: async () => listAiToolDefinitions(),
          callTool: async (name, args) => {
            const result = runAiTool(context(), name, args)
            const detail = name === 'create_node' ? ` args=${JSON.stringify(args).slice(0, 900)}` : ''
            toolLog.push({ name, error: result.isError === true, text: result.text.slice(0, 300) + detail })
            return result
          },
        })
        if (!out) {
          res.writeHead(202)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(out))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-e2e-'))

      let transcript: TranscriptState = emptyTranscript
      const results: unknown[] = []

      for (const raw of prompts) {
        const fresh = raw.startsWith('!')
        const prompt = fresh ? raw.slice(1) : raw
        if (fresh) {
          api = newScene()
          transcript = emptyTranscript
        }
        // Mirror the panel: select the card when the prompt talks about a selected component.
        selection = /selected|this card|the card/i.test(prompt)
          ? [api.getAllNodeIds().find((id) => api.getNode(id)?.name === 'Card') ?? '']
          : []
        const before = snapshotTracks(api)
        toolLog = []
        const args = buildClaudeArgs({
          mcpUrl: `http://127.0.0.1:${port}/mcp`,
          token,
          sessionId: transcript.sessionId ?? undefined,
          systemPrompt: ASSISTANT_SYSTEM_PROMPT,
          maxTurns: 40,
        })
        const started = Date.now()
        const child = spawn(claude, args, { cwd: workdir })
        let buffer = ''
        child.stdout.on('data', (chunk) => {
          buffer += chunk
          let newline = buffer.indexOf('\n')
          while (newline >= 0) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            newline = buffer.indexOf('\n')
            try {
              transcript = applyClaudeEvent(transcript, JSON.parse(line))
            } catch {
              /* not JSON */
            }
          }
        })
        child.stdin.end(`${selectionNote(api, selection)}\n\n${prompt}`)
        const code: number = await new Promise((resolve) => child.on('close', resolve))
        const changes = diffSnapshots(before, snapshotTracks(api))
        const validation = JSON.parse(runAiTool(context(), 'validate_scene', {}).text)
        results.push({
          prompt,
          fresh,
          exit: code,
          seconds: Math.round((Date.now() - started) / 100) / 10,
          tools: toolLog.map(
            (t) => `${displayToolName(t.name)}${t.error ? ' ✗ ' + t.text : t.name === 'create_node' ? t.text : ''}`,
          ),
          createdNodes: [...api.getAllNodeIds()]
            .filter((id) => !before.has(id) && api.getNode(id) && api.getNode(id)!.kind !== 'camera')
            .map((id) => api.getNode(id))
            .filter((node) => node && node.name === 'Border beam')
            .map((node) => ({ name: node!.name, appearance: node!.appearance, size: (node as { size?: unknown }).size })),
          layersChanged: changes.map((c) => `${c.name}: ${c.properties.join(', ')}`),
          valid: validation.ok,
          problems: validation.problems,
          reply: transcript.entries
            .filter((e) => e.kind === 'assistant')
            .slice(-2)
            .map((e) => (e as { text: string }).text)
            .join(' ')
            .slice(0, 700),
          costUsd: transcript.costUsd,
        })
      }
      server.close()
      const out = process.env.HYPERMOTION_E2E_OUT
      if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2))
      expect(results.length).toBe(prompts.length)
    },
    1_200_000,
  )
})
