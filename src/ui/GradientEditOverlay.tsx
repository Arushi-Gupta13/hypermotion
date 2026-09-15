// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import type { NodeId } from '@/scene'
import { gradientEditStore } from '@/ui/gradientEditStore'

export interface GradientEditProjection {
  clientToLocal: (clientX: number, clientY: number) => { x: number; y: number } | null
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** CSS gradient angle convention: 0deg points up, increasing clockwise. */
function directionToAngle(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

function angleToDirection(angleDeg: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.sin(rad), dy: -Math.cos(rad) }
}

/** Half-length of the CSS gradient line for a box of the given size. */
function linearHalfLength(width: number, height: number, angleDeg: number): number {
  const rad = (angleDeg * Math.PI) / 180
  return (Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad))) / 2
}

/**
 * On-canvas Figma-style handles for editing the gradient direction
 * (linear), center (radial), or center + rotation (conic) of whichever
 * fill/stroke gradient popover is currently open, mirroring
 * VectorEditOverlay's projection pattern. Reads its target from
 * gradientEditStore — FillField registers there while its popover is
 * open on a gradient tab.
 */
export function GradientEditOverlay({
  nodeId,
  rectWidth,
  rectHeight,
  zoom,
  projection,
}: {
  nodeId: NodeId
  rectWidth: number
  rectHeight: number
  zoom: number
  projection: GradientEditProjection
}) {
  const target = useSyncExternalStore(
    gradientEditStore.subscribe,
    gradientEditStore.getSnapshot,
    gradientEditStore.getSnapshot,
  )

  if (!target || target.nodeId !== nodeId) return null
  const { fill, onCommit } = target
  const handleR = 5 / Math.max(zoom, 0.001)
  const stemWidth = 1.5 / Math.max(zoom, 0.001)

  const startAngleDrag = (
    center: { x: number; y: number },
    apply: (angle: number) => void,
  ) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const capture = event.currentTarget
    capture.setPointerCapture(event.pointerId)
    const onMove = (moveEvent: PointerEvent) => {
      const local = projection.clientToLocal(moveEvent.clientX, moveEvent.clientY)
      if (!local) return
      apply(directionToAngle(local.x - center.x, local.y - center.y))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const startCenterDrag = (
    apply: (cx: number, cy: number) => void,
  ) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const capture = event.currentTarget
    capture.setPointerCapture(event.pointerId)
    const onMove = (moveEvent: PointerEvent) => {
      const local = projection.clientToLocal(moveEvent.clientX, moveEvent.clientY)
      if (!local) return
      apply(clamp01(local.x / rectWidth), clamp01(local.y / rectHeight))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const handleStyle = {
    pointerEvents: 'all' as const,
    cursor: 'grab',
    touchAction: 'none' as const,
  }

  if (fill.kind === 'linear') {
    const center = { x: rectWidth / 2, y: rectHeight / 2 }
    const half = linearHalfLength(rectWidth, rectHeight, fill.angle)
    const { dx, dy } = angleToDirection(fill.angle)
    const from = { x: center.x - dx * half, y: center.y - dy * half }
    const to = { x: center.x + dx * half, y: center.y + dy * half }
    const onAngle = (angle: number) => onCommit({ ...fill, angle })
    return (
      <g data-gradient-edit={nodeId} className="pointer-events-none">
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="var(--color-accent)"
          strokeWidth={stemWidth}
          pointerEvents="none"
        />
        <circle
          cx={from.x}
          cy={from.y}
          r={handleR}
          fill="var(--color-panel)"
          stroke="var(--color-accent)"
          strokeWidth={stemWidth}
          style={handleStyle}
          onPointerDown={startAngleDrag(center, (angle) => onAngle((angle + 180) % 360))}
        />
        <circle
          cx={to.x}
          cy={to.y}
          r={handleR}
          fill="var(--color-accent)"
          stroke="var(--color-panel)"
          strokeWidth={stemWidth}
          style={handleStyle}
          onPointerDown={startAngleDrag(center, onAngle)}
        />
      </g>
    )
  }

  const center = { x: fill.cx * rectWidth, y: fill.cy * rectHeight }
  const onCenter = (cx: number, cy: number) => onCommit({ ...fill, cx, cy })

  if (fill.kind === 'radial') {
    return (
      <g data-gradient-edit={nodeId} className="pointer-events-none">
        <circle
          cx={center.x}
          cy={center.y}
          r={handleR}
          fill="var(--color-accent)"
          stroke="var(--color-panel)"
          strokeWidth={stemWidth}
          style={handleStyle}
          onPointerDown={startCenterDrag(onCenter)}
        />
      </g>
    )
  }

  // conic
  const spokeLength = Math.min(rectWidth, rectHeight) * 0.35
  const { dx, dy } = angleToDirection(fill.angle)
  const spokeEnd = { x: center.x + dx * spokeLength, y: center.y + dy * spokeLength }
  const onAngle = (angle: number) => onCommit({ ...fill, angle })
  return (
    <g data-gradient-edit={nodeId} className="pointer-events-none">
      <line
        x1={center.x}
        y1={center.y}
        x2={spokeEnd.x}
        y2={spokeEnd.y}
        stroke="var(--color-accent)"
        strokeWidth={stemWidth}
        pointerEvents="none"
      />
      <circle
        cx={center.x}
        cy={center.y}
        r={handleR}
        fill="var(--color-accent)"
        stroke="var(--color-panel)"
        strokeWidth={stemWidth}
        style={handleStyle}
        onPointerDown={startCenterDrag(onCenter)}
      />
      <circle
        cx={spokeEnd.x}
        cy={spokeEnd.y}
        r={handleR * 0.85}
        fill="var(--color-panel)"
        stroke="var(--color-accent)"
        strokeWidth={stemWidth}
        style={handleStyle}
        onPointerDown={startAngleDrag(center, onAngle)}
      />
    </g>
  )
}
