// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smartphone } from 'lucide-react'
import {
  DEVICE_MOCKUP_GROUPS,
  DEVICE_MOCKUP_SPECS,
  type DeviceMockupKind,
  type DeviceMockupSpec,
} from '@/scene/builtins/deviceMockups'

/**
 * Small CSS silhouette standing in for a real render — cheap enough to draw
 * one per row without allocating a WebGL/canvas context per device, same
 * reasoning PaperShaderPicker uses static swatches instead of live previews.
 */
function DeviceSwatch({ spec }: { spec: DeviceMockupSpec }) {
  const aspect = spec.width / spec.height
  const height = 28
  const width = Math.max(14, Math.round(height * aspect))
  return (
    <span
      aria-hidden
      className="relative shrink-0 rounded-[4px] border border-white/10 shadow-inner"
      style={{ width, height, background: spec.bezelColor }}
    >
      {spec.topChrome === 'island' && (
        <span
          className="absolute left-1/2 top-[10%] h-[12%] w-[34%] -translate-x-1/2 rounded-full bg-black"
        />
      )}
      {spec.topChrome === 'notch' && (
        <span
          className="absolute left-1/2 top-0 h-[10%] w-[46%] -translate-x-1/2 rounded-b-full bg-black"
        />
      )}
      {spec.topChrome === 'punchhole' && (
        <span
          className="absolute left-1/2 top-[12%] h-[8%] w-[8%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black"
        />
      )}
      {spec.homeButton && (
        <span
          className="absolute bottom-[6%] left-1/2 h-[10%] w-[10%] -translate-x-1/2 rounded-full border border-white/40"
        />
      )}
    </span>
  )
}

export function DeviceMockupPicker({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement
  onSelect: (kind: DeviceMockupKind) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const popover = ref.current
    if (!popover) return
    const trigger = anchor.getBoundingClientRect()
    const rect = popover.getBoundingClientRect()
    const gap = 8
    const edge = 8
    let left = trigger.left + trigger.width / 2 - rect.width / 2
    left = Math.min(window.innerWidth - rect.width - edge, Math.max(edge, left))
    let top = trigger.top - rect.height - gap
    if (top < edge) top = Math.min(window.innerHeight - rect.height - edge, trigger.bottom + gap)
    setPosition({ left, top })
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      data-export-hide="1"
      role="dialog"
      aria-label="Device mockups"
      style={{
        position: 'fixed',
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        visibility: position ? 'visible' : 'hidden',
        width: 260,
        maxHeight: 'min(420px, calc(100vh - 16px))',
      }}
      className="z-[120] flex flex-col overflow-hidden rounded-xl border border-border-strong bg-panel-raised shadow-[var(--shadow-dock)]"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
          <Smartphone size={15} />
        </span>
        <div className="text-[12px] font-semibold text-text">Device mockups</div>
      </div>
      <div role="listbox" aria-label="Available device mockups" className="min-h-0 overflow-y-auto p-2">
        {DEVICE_MOCKUP_GROUPS.map((group) => (
          <div key={group.label} className="mb-1 last:mb-0">
            <div className="px-1.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-dim">
              {group.label}
            </div>
            {group.kinds.map((kind) => {
              const spec = DEVICE_MOCKUP_SPECS[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  role="option"
                  onClick={() => {
                    onSelect(kind)
                    onClose()
                  }}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-control"
                >
                  <DeviceSwatch spec={spec} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-text">
                      {spec.label}
                    </span>
                    <span className="mt-0.5 block text-[9px] text-text-dim">
                      {spec.width}×{spec.height}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
