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
    // A dense grid of small rectangular cards, packed tighter toward
    // the center and thinning slightly toward the edges — matches the
    // actual template's geometry (sphereInteriorSlotTransforms in
    // perspectiveTemplates.ts, the same concave "camera inside a
    // hollow shell" arrangement sphere-wall uses, just denser and
    // smaller-carded). Deliberately rectangles, not circles: the old
    // glyph (and the old template itself) used a corner radius exactly
    // half the slot size, which rendered as circular dots rather than
    // cards.
    const cols = 9
    const rows = 7
    const cell = 3.4
    const gapX = 0.7
    const gapY = 0.8
    const totalW = cols * cell + (cols - 1) * gapX
    const totalH = rows * cell + (rows - 1) * gapY
    const originX = 20 - totalW / 2
    const originY = 20 - totalH / 2
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        {Array.from({ length: cols * rows }).map((_, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const colOffset = (col - (cols - 1) / 2) / (cols / 2)
          const rowOffset = (row - (rows - 1) / 2) / (rows / 2)
          const faceOn = Math.cos((colOffset * Math.PI) / 2.4) * Math.cos((rowOffset * Math.PI) / 2.4)
          const w = cell * (0.6 + 0.4 * faceOn)
          const h = cell * (0.6 + 0.4 * faceOn)
          const cx = originX + col * (cell + gapX) + cell / 2
          const cy = originY + row * (cell + gapY) + cell / 2
          return (
            <rect
              key={i}
              x={cx - w / 2}
              y={cy - h / 2}
              width={w}
              height={h}
              rx={0.5}
              fill="var(--color-accent)"
              opacity={0.35 + 0.45 * faceOn}
            />
          )
        })}
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
  if (kind === 'sphere-wall') {
    // A grid wrapped around a sphere — columns stay aligned (same
    // azimuth in every row), but shrink toward the sides via a cosine
    // falloff, and rows dome slightly toward the top/bottom — a
    // stylized stand-in for the real template's concave, camera-inside
    // geometry (sphereInteriorSlotTransforms), curved in both
    // directions, not a flat cylinder or flat wall.
    const cols = 7
    const rows = 5
    const cell = 4.6
    const gapX = 0.9
    const gapY = 1.1
    const totalW = cols * cell + (cols - 1) * gapX
    const totalH = rows * cell * 0.75 + (rows - 1) * gapY
    const originX = 20 - totalW / 2
    const originY = 20 - totalH / 2
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        {Array.from({ length: cols * rows }).map((_, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const colOffset = (col - (cols - 1) / 2) / (cols / 2)
          const rowOffset = (row - (rows - 1) / 2) / (rows / 2)
          const faceOn = Math.cos((colOffset * Math.PI) / 2.2) * Math.cos((rowOffset * Math.PI) / 2.6)
          const w = cell * (0.45 + 0.55 * faceOn)
          const h = cell * 0.75
          const cx = originX + col * (cell + gapX) + cell / 2
          const cy = originY + row * (cell * 0.75 + gapY) + h / 2
          return (
            <rect
              key={i}
              x={cx - w / 2}
              y={cy - h / 2}
              width={w}
              height={h}
              rx={0.6}
              fill="var(--color-accent)"
              opacity={0.28 + 0.5 * faceOn}
            />
          )
        })}
      </svg>
    )
  }
  return null
}
