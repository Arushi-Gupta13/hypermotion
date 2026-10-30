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
