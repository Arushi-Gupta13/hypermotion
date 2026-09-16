// SPDX-License-Identifier: Apache-2.0

import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import {
  PERSPECTIVE_TEMPLATES,
  containerSizeFor,
  insertPerspectiveTemplate,
  type PerspectiveTemplateKind,
} from '@/scene/builtins/perspectiveTemplates'

/**
 * "Perspective" tab — a gallery of multi-slot 3D arrangement templates
 * (ring/tunnel/etc., inspired by Animos's "3D & Perspective" category).
 * Unlike the single-layer presets in the Animate tab, a template here
 * inserts a whole new arrangement of empty media slots plus a baked
 * spin animation, in one click.
 */
export function PerspectivePanel() {
  const api = useSceneAPI()
  const setSelection = useUI((s) => s.setSelection)
  const setTool = useUI((s) => s.setTool)
  const playhead = useUI((s) => s.playhead)

  const insertTemplate = (kind: PerspectiveTemplateKind) => {
    const rootId = api.getRoot()
    if (!rootId) return
    const meta = api.getMeta()
    const spec = PERSPECTIVE_TEMPLATES[kind]
    const containerSize = containerSizeFor(spec, spec)
    const id = insertPerspectiveTemplate(
      api,
      rootId,
      kind,
      {
        x: Math.round((meta.canvas.width - containerSize) / 2),
        y: Math.round((meta.canvas.height - containerSize) / 2),
      },
      playhead,
    )
    setSelection([id])
    setTool('select')
  }

  return (
    <div className="space-y-3" data-timeline-selection-surface="1">
      <div>
        <div className="text-[11px] font-semibold text-text-muted">3D & Perspective</div>
        <p className="mt-0.5 text-[10px] leading-4 text-text-dim">
          Inserts a ring of empty slots plus a spin animation, starting at
          the playhead. Drop an image onto any slot to fill it.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.entries(PERSPECTIVE_TEMPLATES) as Array<
          [PerspectiveTemplateKind, (typeof PERSPECTIVE_TEMPLATES)[PerspectiveTemplateKind]]
        >).map(([kind, spec]) => (
          <button
            key={kind}
            type="button"
            onClick={() => insertTemplate(kind)}
            className="group flex flex-col gap-1.5 rounded-md border border-border-strong/60 bg-panel-raised p-1.5 text-left transition-colors hover:border-border-strong hover:bg-panel"
          >
            <div className="grid h-16 w-full place-items-center rounded-[5px] bg-panel">
              <PerspectiveTemplateGlyph kind={kind} />
            </div>
            <span className="px-1 pb-0.5 text-[11px] text-text">{spec.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** A tiny static ring-of-cards glyph — no hover animation yet (unlike the layer presets), since this inserts a whole arrangement rather than tweening one layer. */
function PerspectiveTemplateGlyph({ kind }: { kind: PerspectiveTemplateKind }) {
  if (kind === 'card-tunnel') {
    const cards = 6
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        {Array.from({ length: cards }).map((_, i) => {
          const angle = (i / cards) * Math.PI * 2
          const cx = 20 + Math.sin(angle) * 12
          const scale = 0.6 + 0.4 * ((Math.cos(angle) + 1) / 2)
          return (
            <rect
              key={i}
              x={cx - 3.5 * scale}
              y={20 - 6 * scale}
              width={7 * scale}
              height={12 * scale}
              rx={1.5 * scale}
              fill="var(--color-accent)"
              opacity={0.35 + 0.5 * scale}
            />
          )
        })}
      </svg>
    )
  }
  if (kind === 'orbit-globe') {
    // Stacked horizontal latitude rings, narrowing toward the top and
    // bottom — matches the actual template's geometry (bandsSlotTransforms
    // in perspectiveTemplates.ts): a handful of evenly-spaced rings
    // rather than a scattered sphere of points, so each card always has
    // clearance from the camera-facing silhouette edge instead of some
    // landing edge-on as a sliver.
    const latitudes = [62, 31, 0, -31, -62]
    const globeRadius = 15
    const bands = latitudes.map((lat) => {
      const rad = (lat * Math.PI) / 180
      return { cy: 20 - Math.sin(rad) * globeRadius, rx: Math.cos(rad) * globeRadius, count: lat === 0 ? 8 : 6 }
    })
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={globeRadius} fill="none" stroke="var(--color-accent)" strokeOpacity="0.12" />
        {bands.map((band, bi) =>
          Array.from({ length: band.count }).map((_, i) => {
            const t = i / band.count
            // Only draw the near half of each ring's ellipse (a dot
            // sweeping behind the ring wouldn't read at this size).
            const angle = Math.PI * 0.15 + t * Math.PI * 0.7
            const cx = 20 + Math.sin(angle) * band.rx
            const depth = Math.cos(angle)
            return (
              <circle
                key={`${bi}-${i}`}
                cx={cx}
                cy={band.cy}
                r={1.5 + depth * 0.6}
                fill="var(--color-accent)"
                opacity={0.45 + depth * 0.35}
              />
            )
          }),
        )}
      </svg>
    )
  }
  if (kind === 'totem-wall') {
    // Each column nudged in x and shrunk slightly to hint the depth
    // stagger + baked-in yaw the real template uses, rather than a flat
    // frontal grid — matches what "Perspective" is supposed to convey.
    const cols = 3
    const rows = 3
    const cell = 8
    const gap = 2.5
    const colSkew = 3
    const totalW = cols * cell + (cols - 1) * gap + colSkew * (cols - 1)
    const totalH = rows * cell + (rows - 1) * gap
    const originX = 20 - totalW / 2
    const originY = 20 - totalH / 2
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        {Array.from({ length: cols * rows }).map((_, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const depthScale = 1 - Math.abs(col - (cols - 1) / 2) * 0.08
          return (
            <rect
              key={i}
              x={originX + col * (cell + gap + colSkew)}
              y={originY + row * (cell + gap) + (col - (cols - 1) / 2) * 1.5}
              width={cell * depthScale}
              height={cell * depthScale}
              rx={1.2}
              fill="var(--color-accent)"
              opacity={0.35 + 0.15 * depthScale * 2}
            />
          )
        })}
      </svg>
    )
  }
  return null
}
