// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSceneAPI } from '@/scene/hooks'
import { useUI } from '@/state/ui'
import { PROVIDER_LABELS, useAssistant, type AiProvider } from '@/ai/store'
import { displayToolName, type TranscriptEntry } from '@/ai/transcript'
import { AppIcon } from '@/ui/AppIcon'

const SUGGESTIONS = [
  'Animate the selected layers in one after another with a soft fade and slide.',
  'Make the entrance feel more premium and cinematic.',
  'Add a slow camera push-in toward the selected layer.',
  'Increase the stagger between these elements.',
]

interface ModelOption {
  id: string
  label: string
}

type ProviderStatus =
  | { available: true; path: string; version: string | null; models: ModelOption[]; defaultModel?: string | null }
  | { available: false; models: ModelOption[]; defaultModel?: string | null }

type AssistantStatus = Record<AiProvider, ProviderStatus>

const CUSTOM_MODEL = '__custom__'

function useAssistantStatus(): AssistantStatus | null {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.hypermotion
      ?.invoke('ai:status')
      .then((value) => {
        if (!cancelled) setStatus(value as AssistantStatus)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            claude: { available: false, models: [] },
            codex: { available: false, models: [] },
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

export function AssistantPanel() {
  const api = useSceneAPI()
  const open = useAssistant((s) => s.open)
  const width = useAssistant((s) => s.width)
  const setWidth = useAssistant((s) => s.setWidth)
  const setOpen = useAssistant((s) => s.setOpen)
  const transcript = useAssistant((s) => s.transcript)
  const running = useAssistant((s) => s.running)
  const review = useAssistant((s) => s.review)
  const send = useAssistant((s) => s.send)
  const stop = useAssistant((s) => s.stop)
  const keep = useAssistant((s) => s.keep)
  const revert = useAssistant((s) => s.revert)
  const tryAgain = useAssistant((s) => s.tryAgain)
  const clear = useAssistant((s) => s.clear)
  const selection = useUI((s) => s.selection)
  const status = useAssistantStatus()
  const provider = useAssistant((s) => s.provider)
  const model = useAssistant((s) => s.models[s.provider])
  const setProvider = useAssistant((s) => s.setProvider)
  const setModel = useAssistant((s) => s.setModel)
  const [customOpen, setCustomOpen] = useState(false)

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const selectedNames = selection
    .map((id) => api.getNode(id)?.name)
    .filter((name): name is string => Boolean(name))

  // Keep the newest output in view, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [transcript, review])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const submit = () => {
    const text = draft.trim()
    if (!text || running) return
    const state = useUI.getState()
    const names = state.selection
      .map((id) => {
        const node = api.getNode(id)
        return node ? `"${node.name}" (${node.kind}, id ${id})` : null
      })
      .filter(Boolean)
    const note = [
      '[Editor state]',
      names.length > 0 ? `Selected layers: ${names.join(', ')}.` : 'Nothing is selected.',
      `Playhead: ${state.playhead.toFixed(2)}s.`,
    ].join(' ')
    setDraft('')
    stickToBottom.current = true
    void send(text, note)
  }

  const onResizeDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => setWidth(startWidth - (move.clientX - startX))
    const onUp = (up: PointerEvent) => {
      try {
        target.releasePointerCapture(up.pointerId)
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const empty = transcript.entries.length === 0
  const current = status?.[provider] ?? null
  const unavailable = current !== null && !current.available
  const modelOptions: ModelOption[] = current
    ? [
        {
          id: '',
          label:
            provider === 'codex' && current.defaultModel
              ? `Default (${current.defaultModel})`
              : 'Default',
        },
        ...current.models.filter((option) => option.id !== ''),
      ]
    : [{ id: '', label: 'Default' }]
  const knownModel = modelOptions.some((option) => option.id === model)
  const selectValue = customOpen || !knownModel ? CUSTOM_MODEL : model

  return (
    <aside
      data-assistant-panel="1"
      aria-label="AI assistant"
      className="relative flex shrink-0 flex-col border-l border-border bg-panel"
      style={{ width }}
    >
      <div
        onPointerDown={onResizeDown}
        title="Drag to resize"
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
      />

      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <AppIcon name="sparkle" size={15} className="text-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text">Assistant</div>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={running || empty}
          title="Start a new conversation"
          className="h-7 rounded-[var(--radius-control)] px-2 text-[11px] font-medium text-text-muted hover:bg-control hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          New chat
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          title="Close"
          className="hm-icon-button h-7 w-7"
        >
          ✕
        </button>
      </header>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(event) => {
              setCustomOpen(false)
              setProvider(event.target.value as AiProvider)
            }}
            disabled={running}
            aria-label="AI provider"
            title="Which signed-in app runs the assistant"
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-control)] bg-control px-2 text-[12px] text-text shadow-[var(--shadow-control)] outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-50"
          >
            {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
                {status && !status[id].available ? ' (not installed)' : ''}
              </option>
            ))}
          </select>
          <select
            value={selectValue}
            onChange={(event) => {
              if (event.target.value === CUSTOM_MODEL) {
                setCustomOpen(true)
              } else {
                setCustomOpen(false)
                setModel(event.target.value)
              }
            }}
            disabled={running}
            aria-label="Model"
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-control)] bg-control px-2 text-[12px] text-text shadow-[var(--shadow-control)] outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-50"
          >
            {modelOptions.map((option) => (
              <option key={option.id || 'default'} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>Custom…</option>
          </select>
        </div>
        {selectValue === CUSTOM_MODEL ? (
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={provider === 'codex' ? 'Model id, e.g. gpt-5.6-terra' : 'Model id, e.g. claude-opus-5-5'}
            aria-label="Custom model id"
            spellCheck={false}
            className="mt-2 h-7 w-full rounded-[var(--radius-control)] bg-control px-2 font-mono text-[12px] text-text shadow-[var(--shadow-control)] outline-none placeholder:text-text-dim focus-visible:ring-2 focus-visible:ring-accent/45"
          />
        ) : null}
        {provider === 'codex' ? (
          <p className="mt-1.5 text-[11px] leading-4 text-text-dim">
            Uses your ChatGPT sign-in through the Codex CLI. Beta: not yet verified with live tool calls.
          </p>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {unavailable ? (
          <ProviderMissing provider={provider} />
        ) : empty ? (
          <EmptyState onPick={(text) => setDraft(text)} />
        ) : (
          <div className="space-y-3">
            {transcript.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
            {running ? <Working /> : null}
          </div>
        )}
      </div>

      {review ? (
        <div
          role="status"
          className="shrink-0 border-t border-border bg-panel-raised px-3 py-2.5"
        >
          <div className="mb-2 text-[12px] text-text">
            Changed the scene
            <span className="text-text-dim">
              {' '}
              · {review.depthAfter - review.depthBefore} step
              {review.depthAfter - review.depthBefore === 1 ? '' : 's'}, already on the canvas
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={keep}
              className="hm-primary-action h-7 flex-1 text-[12px]"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={revert}
              className="hm-secondary-action h-7 flex-1 text-[12px]"
              title="Undo everything this turn changed"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={() => void tryAgain()}
              className="hm-secondary-action h-7 flex-1 text-[12px]"
              title="Revert, then run the same prompt again"
            >
              Try again
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-text-dim">
            Or describe what to change below to refine it.
          </div>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-border p-3">
        {selectedNames.length > 0 ? (
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-text-dim">
            <span>Working on</span>
            <span className="min-w-0 truncate rounded bg-control px-1.5 py-0.5 text-text-muted">
              {selectedNames.slice(0, 3).join(', ')}
              {selectedNames.length > 3 ? ` +${selectedNames.length - 3}` : ''}
            </span>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Keep editor shortcuts (Space, V, R…) from firing while typing.
              event.stopPropagation()
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            rows={2}
            disabled={unavailable}
            placeholder={
              unavailable
                ? `Install ${provider === 'codex' ? 'the Codex CLI' : 'Claude Code'} to use the assistant`
                : 'Describe the animation you want…'
            }
            aria-label="Message the assistant"
            className="max-h-40 min-h-[52px] flex-1 resize-none rounded-[var(--radius-control)] bg-control px-2.5 py-2 text-[13px] leading-5 text-text shadow-[var(--shadow-control)] outline-none placeholder:text-text-dim focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-50"
          />
          {running ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="hm-secondary-action h-8 shrink-0 px-3 text-[12px]"
              title="Stop generating"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || unavailable}
              className="hm-primary-action h-8 shrink-0 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-40"
              title="Send (Enter)"
            >
              Send
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-dim">
          <span>Enter to send · Shift+Enter for a new line</span>
          {transcript.costUsd > 0 ? <span>${transcript.costUsd.toFixed(3)} this chat</span> : null}
        </div>
      </div>
    </aside>
  )
}

function Working() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-text-dim" aria-live="polite">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      Working…
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-4 pt-2">
      <div>
        <div className="text-[13px] font-medium text-text">Describe it, and it gets built</div>
        <p className="mt-1 text-[12px] leading-5 text-text-muted">
          The assistant reads your scene, edits layers and timeline tracks directly, and shows the
          result on the canvas. Every change is undoable.
        </p>
      </div>
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.5px] text-text-dim">Try</div>
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="block w-full rounded-[var(--radius-control)] bg-control px-2.5 py-2 text-left text-[12px] leading-5 text-text-muted shadow-[var(--shadow-control)] hover:bg-control-hover hover:text-text"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function ProviderMissing({ provider }: { provider: AiProvider }) {
  return provider === 'codex' ? (
    <div className="space-y-2 pt-2 text-[12px] leading-5 text-text-muted">
      <div className="text-[13px] font-medium text-text">The Codex CLI was not found</div>
      <p>
        ChatGPT runs through OpenAI&apos;s Codex CLI, so there is no API key to manage. Install it
        (<code>npm i -g @openai/codex</code>), run <code>codex</code> once and choose &quot;Sign in
        with ChatGPT&quot;, then reopen this panel.
      </p>
      <p className="text-text-dim">
        Installed somewhere unusual? Set <code>HYPERMOTION_CODEX_PATH</code> to its full path and
        restart the app.
      </p>
    </div>
  ) : (
    <div className="space-y-2 pt-2 text-[12px] leading-5 text-text-muted">
      <div className="text-[13px] font-medium text-text">Claude Code was not found</div>
      <p>
        The assistant runs your local Claude Code, so there is no API key to manage. Install it
        from claude.com/claude-code, sign in once in a terminal with <code>claude</code>, then
        reopen this panel.
      </p>
      <p className="text-text-dim">
        Already installed somewhere unusual? Set <code>HYPERMOTION_CLAUDE_PATH</code> to its full
        path and restart the app.
      </p>
    </div>
  )
}

function Entry({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="ml-6 whitespace-pre-wrap rounded-[var(--radius-panel)] bg-control px-2.5 py-2 text-[13px] leading-5 text-text">
          {entry.text}
        </div>
      )
    case 'assistant':
      return entry.text ? (
        <div className="whitespace-pre-wrap text-[13px] leading-5 text-text">
          {entry.text}
          {entry.streaming ? <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-text-dim" /> : null}
        </div>
      ) : null
    case 'notice':
      return (
        <div
          role={entry.tone === 'error' ? 'alert' : 'status'}
          className={[
            'rounded-[var(--radius-control)] px-2.5 py-2 text-[12px] leading-5',
            entry.tone === 'error'
              ? 'bg-red-500/10 text-red-500'
              : 'bg-control text-text-muted',
          ].join(' ')}
        >
          {entry.text}
        </div>
      )
    case 'tool':
      return <ToolRow entry={entry} />
  }
}

function ToolRow({ entry }: { entry: Extract<TranscriptEntry, { kind: 'tool' }> }) {
  const name = displayToolName(entry.name)
  const input = typeof entry.input === 'object' && entry.input !== null ? JSON.stringify(entry.input) : ''
  return (
    <details className="group rounded-[var(--radius-control)] bg-control/60 text-[11px] shadow-[var(--shadow-control)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 font-mono">
        <StatusDot status={entry.status} />
        <span className="shrink-0 text-text">{name}</span>
        <span className="min-w-0 flex-1 truncate text-text-dim">{input === '{}' ? '' : input}</span>
      </summary>
      <div className="space-y-1.5 border-t border-border px-2 py-1.5 font-mono text-text-muted">
        {input ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(entry.input, null, 2)}
          </pre>
        ) : null}
        {entry.result ? (
          <pre
            className={[
              'max-h-40 overflow-auto whitespace-pre-wrap break-words',
              entry.status === 'error' ? 'text-red-500' : '',
            ].join(' ')}
          >
            {entry.result.length > 4000 ? `${entry.result.slice(0, 4000)}…` : entry.result}
          </pre>
        ) : null}
      </div>
    </details>
  )
}

function StatusDot({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') {
    return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label="Running" />
  }
  return (
    <span
      className={[
        'h-1.5 w-1.5 shrink-0 rounded-full',
        status === 'done' ? 'bg-emerald-500' : 'bg-red-500',
      ].join(' ')}
      aria-label={status === 'done' ? 'Done' : 'Failed'}
    />
  )
}
