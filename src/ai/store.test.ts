// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.stubGlobal('window', { hypermotion: { invoke }, localStorage: undefined })

const { useAssistant } = await import('@/ai/store')

function resetStore() {
  useAssistant.setState({
    provider: 'claude',
    models: { claude: '', codex: '' },
    sessionProvider: null,
    turnProvider: null,
    running: false,
    turnId: null,
    review: null,
    turnBaseline: null,
    transcript: { entries: [], sessionId: null, costUsd: 0, blocks: {}, currentMessageId: null },
  })
}

async function finishTurn(sessionId: string) {
  const turnId = useAssistant.getState().turnId!
  useAssistant.getState().onClaudeEvent(turnId, { type: 'system', subtype: 'init', session_id: sessionId })
  useAssistant.getState().onTurnDone({ turnId, code: 0, stopped: false, stderr: '' })
}

describe('assistant provider and model selection', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({ turnId: 'turn-1' })
    resetStore()
  })

  it('sends the chosen provider and model, and none when set to default', async () => {
    useAssistant.setState({ provider: 'codex', models: { claude: '', codex: 'gpt-5.6-terra' } })
    await useAssistant.getState().send('animate it')
    expect(invoke).toHaveBeenCalledWith(
      'ai:send',
      expect.objectContaining({ provider: 'codex', model: 'gpt-5.6-terra', sessionId: undefined }),
    )

    await finishTurn('thread-1')
    useAssistant.setState({ provider: 'claude' })
    invoke.mockClear()
    await useAssistant.getState().send('again')
    expect(invoke.mock.calls[0][1]).toMatchObject({ provider: 'claude', model: undefined })
  })

  it('continues the same session for the same provider', async () => {
    await useAssistant.getState().send('first')
    await finishTurn('sess-1')
    invoke.mockClear()
    await useAssistant.getState().send('second')
    expect(invoke.mock.calls[0][1]).toMatchObject({ provider: 'claude', sessionId: 'sess-1' })
  })

  it('never hands one CLI the other CLI\'s session id, and says so in the chat', async () => {
    await useAssistant.getState().send('first')
    await finishTurn('claude-session')
    useAssistant.getState().setProvider('codex')
    invoke.mockClear()
    await useAssistant.getState().send('carry on')

    expect(invoke.mock.calls[0][1]).toMatchObject({ provider: 'codex', sessionId: undefined })
    const notices = useAssistant.getState().transcript.entries.filter((e) => e.kind === 'notice')
    expect(notices.at(-1)).toMatchObject({ tone: 'info' })
    expect((notices.at(-1) as { text: string }).text).toContain('Switched to ChatGPT')
  })
})

describe('what a finished turn reports', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({ turnId: 'turn-1' })
    resetStore()
  })

  async function scene() {
    const { createSceneAPI } = await import('@/scene/doc')
    const { addKeyframe } = await import('@/anim/tracks')
    const { registerSceneProbe, snapshotTracks } = await import('@/ai/sceneProbe')
    const { useUI } = await import('@/state/ui')
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Scene' })
    const title = api.createNode('rect', root, { name: 'Title' })
    registerSceneProbe(() => snapshotTracks(api))
    useUI.getState().clearSelection()
    return { api, title, addKeyframe, useUI }
  }

  const toolDone = (name: string) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: `mcp__canvas__${name}`, input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } },
  ]

  it('lists the layers whose animation really changed, and selects them', async () => {
    const { title, api, addKeyframe, useUI } = await scene()
    await useAssistant.getState().send('fade the title in')
    addKeyframe(api, title, 'appearance.opacity', 0, 0)
    addKeyframe(api, title, 'appearance.opacity', 0.5, 1)
    await finishTurn('s')

    const review = useAssistant.getState().review
    expect(review?.changes).toEqual([
      { nodeId: title, name: 'Title', tracks: 1, properties: ['appearance.opacity'], present: true },
    ])
    expect(useUI.getState().selection).toEqual([title])
  })

  it('says so when edit tools ran but the scene did not change', async () => {
    await scene()
    await useAssistant.getState().send('fade the title in')
    const turnId = useAssistant.getState().turnId!
    for (const event of toolDone('animate_nodes')) useAssistant.getState().onClaudeEvent(turnId, event)
    useAssistant.getState().onTurnDone({ turnId, code: 0, stopped: false, stderr: '' })

    expect(useAssistant.getState().review).toBeNull()
    const notices = useAssistant.getState().transcript.entries.filter((e) => e.kind === 'notice')
    expect((notices.at(-1) as { text: string }).text).toContain('nothing in the scene changed')
  })

  it('stays quiet for a read-only question', async () => {
    await scene()
    await useAssistant.getState().send('what is selected?')
    const turnId = useAssistant.getState().turnId!
    for (const event of toolDone('get_scene')) useAssistant.getState().onClaudeEvent(turnId, event)
    useAssistant.getState().onTurnDone({ turnId, code: 0, stopped: false, stderr: '' })
    expect(useAssistant.getState().transcript.entries.some((e) => e.kind === 'notice')).toBe(false)
  })
})
