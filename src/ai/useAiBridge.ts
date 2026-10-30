// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { useSceneAPI } from '@/scene/hooks'
import { useUI } from '@/state/ui'
import { useAssistant } from '@/ai/store'
import { listAiToolDefinitions, runAiTool, type AiToolContext } from '@/ai/tools'
import { registerSceneProbe, snapshotTracks } from '@/ai/sceneProbe'

interface RpcRequest {
  requestId: string
  kind: 'list-tools' | 'call-tool'
  name?: string
  args?: Record<string, unknown>
}

/**
 * Connects the main process's assistant bridge to this window: answers Claude's
 * tool requests against the live scene and feeds streamed events and turn
 * completion into the assistant store. Mount once, inside the scene provider.
 */
export function useAiBridge(): void {
  const api = useSceneAPI()
  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
  }, [api])

  // Lets the store compare the scene before and after a turn.
  useEffect(() => {
    registerSceneProbe(() => snapshotTracks(apiRef.current))
    return () => registerSceneProbe(null)
  }, [])

  useEffect(() => {
    const bridge = window.hypermotion
    const subscribe = bridge?.on
    if (!bridge || !subscribe) return

    const context = (): AiToolContext => {
      const ui = useUI.getState()
      return {
        api: apiRef.current,
        getSelection: () => useUI.getState().selection,
        setSelection: ui.setSelection,
        getPlayhead: () => useUI.getState().playhead,
        setPlayhead: ui.setPlayhead,
        setPlaying: ui.setPlaying,
      }
    }

    const offRpc = subscribe('ai:rpc', (raw) => {
      const request = raw as RpcRequest
      const reply = (payload: { ok: boolean; value?: unknown; error?: string }) =>
        void bridge.invoke('ai:rpc-result', { requestId: request.requestId, ...payload })
      try {
        if (request.kind === 'list-tools') {
          reply({ ok: true, value: listAiToolDefinitions() })
        } else if (request.kind === 'call-tool' && typeof request.name === 'string') {
          reply({ ok: true, value: runAiTool(context(), request.name, request.args ?? {}) })
        } else {
          reply({ ok: false, error: 'Unsupported request.' })
        }
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    const offEvent = subscribe('ai:event', (raw) => {
      const payload = raw as { turnId: string; event: unknown }
      useAssistant.getState().onClaudeEvent(payload.turnId, payload.event)
    })

    const offDone = subscribe('ai:done', (raw) => {
      useAssistant.getState().onTurnDone(
        raw as { turnId: string; code: number | null; stopped: boolean; stderr: string },
      )
    })

    return () => {
      offRpc()
      offEvent()
      offDone()
    }
  }, [])
}
