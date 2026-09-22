// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { useSceneAPI } from '@/scene'
import type { NodeId } from '@/scene'
import type { Transform } from '@/scene/types'
import {
  projectedResizeHandles,
  type PlaneQuad,
  type ProjectedPoint2D,
} from '@/render3d/selectionProjection'
import { cameraOrbitFromPointer } from '@/ui/cameraNavigation'
import { renderModeForTiltCommit } from '@/ui/tiltHandleLogic'
import { useUI } from '@/state/ui'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim'
import { nodeTransformPreviewStore } from '@/ui/nodeTransformPreviewStore'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

function normalize(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy)
  return len > 0.0001 ? { dx: dx / len, dy: dy / len } : { dx: 0, dy: -1 }
}

/**
 * A single on-canvas drag handle that tilts the selected layer in 3D —
 * the Raylight-style "lean this flat layer back for depth" gesture,
 * dragging `transform.rotationX`/`rotationY` instead of typing exact
 * degrees in the Inspector (which still works exactly as before; this is
 * an additional, faster on-canvas path to the same two fields).
 *
 * Sits on a short stalk beyond the existing top-center resize handle.
 * Drag math is `cameraOrbitFromPointer` (`src/ui/cameraNavigation.ts`) —
 * already generic over any `{rotationX, rotationY}` pair, not
 * camera-specific — fed raw screen-pixel pointer deltas exactly like the
 * camera's own middle-mouse orbit drag in Canvas.tsx.
 *
 * Two positioning modes, mirroring `ResizeHandles`' own dual-mode design:
 * - `quad` given (CameraSelectionOverlay's real 3D camera projection):
 *   anchor sits beyond the quad's own projected 'n' handle, along the
 *   n→s direction — correct even when the camera itself is rotated, since
 *   it's derived from the same projected corners as the resize handles.
 * - `quad` omitted (SelectionOverlay's simpler DOM fallback, used only
 *   when there's no accurate 3D camera view active): anchor is a plain
 *   rect-relative top-center offset, matching `ResizeHandles`' own
 *   fallback handle positions.
 */
export function TiltHandle({
  nodeId,
  rectWidth,
  zoom,
  quad,
}: {
  nodeId: NodeId
  rectWidth: number
  zoom: number
  quad?: PlaneQuad<ProjectedPoint2D>
}) {
  const api = useSceneAPI()

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const node = api.getNode(nodeId)
      if (!node || node.locked) return

      const startRotationX = node.transform.rotationX
      const startRotationY = node.transform.rotationY
      const startRenderMode = node.transform.renderMode
      const isRootChild = node.parent === api.getRoot()
      const startX = e.clientX
      const startY = e.clientY
      let latest: Pick<Transform, 'rotationX' | 'rotationY'> = {
        rotationX: startRotationX,
        rotationY: startRotationY,
      }
      let moved = false

      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        latest = cameraOrbitFromPointer({
          startRotationX,
          startRotationY,
          deltaX: ev.clientX - startX,
          deltaY: ev.clientY - startY,
        })
        moved = true
        nodeTransformPreviewStore.preview({ [nodeId]: latest })
      }

      const finishDrag = (ev: PointerEvent, cancelled: boolean) => {
        if (ev.pointerId !== e.pointerId) return
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          // pointer may already be released by the browser
        }
        if (!cancelled && moved) {
          const current = api.getNode(nodeId)
          if (current) {
            const renderMode = renderModeForTiltCommit(startRenderMode, isRootChild)
            api.doc.transact(() => {
              api.setNodeProperty(nodeId, 'transform', {
                ...current.transform,
                ...latest,
                ...(renderMode ? { renderMode } : {}),
              })
              const ui = useUI.getState()
              if (ui.recording) {
                recordKeyframesForPatch(api, nodeId, ui.playhead, 'transform', latest)
              } else {
                stampToActiveTracksForPatch(api, nodeId, ui.playhead, 'transform', latest)
              }
            }, UNDOABLE_GESTURE_ORIGIN)
          }
          nodeTransformPreviewStore.finish()
        } else {
          nodeTransformPreviewStore.clear()
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }

      const onUp = (ev: PointerEvent) => finishDrag(ev, false)
      const onCancel = (ev: PointerEvent) => finishDrag(ev, true)

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [api, nodeId],
  )

  const handleSize = 8 / Math.max(zoom, 0.001)
  const half = handleSize / 2
  const stalkLength = 20 / Math.max(zoom, 0.001)
  const stemWidth = 1.5 / Math.max(zoom, 0.001)

  let anchor: { x: number; y: number }
  let stalkFrom: { x: number; y: number }
  if (quad) {
    const handles = projectedResizeHandles(quad)
    const nPoint = handles.find((h) => h.id === 'n')!.point
    const sPoint = handles.find((h) => h.id === 's')!.point
    const { dx, dy } = normalize(nPoint.x - sPoint.x, nPoint.y - sPoint.y)
    anchor = { x: nPoint.x + dx * stalkLength, y: nPoint.y + dy * stalkLength }
    stalkFrom = nPoint
  } else {
    stalkFrom = { x: rectWidth / 2, y: -half }
    anchor = { x: rectWidth / 2, y: -half - stalkLength }
  }

  const stalkDx = anchor.x - stalkFrom.x
  const stalkDy = anchor.y - stalkFrom.y
  const stalkDistance = Math.hypot(stalkDx, stalkDy)
  const stalkAngleDeg = (Math.atan2(stalkDy, stalkDx) * 180) / Math.PI

  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{
          left: stalkFrom.x,
          top: stalkFrom.y - stemWidth / 2,
          width: stalkDistance,
          height: stemWidth,
          transform: `rotate(${stalkAngleDeg}deg)`,
          transformOrigin: '0 50%',
          background: 'var(--color-accent)',
        }}
      />
      <div
        data-canvas-control="tilt"
        data-node-id={nodeId}
        onPointerDown={startDrag}
        onClick={(event) => event.stopPropagation()}
        className="absolute rounded-full bg-panel"
        style={{
          left: anchor.x - half,
          top: anchor.y - half,
          width: handleSize,
          height: handleSize,
          pointerEvents: 'auto',
          cursor: 'grab',
          touchAction: 'none',
          border: `${stemWidth}px solid var(--color-accent)`,
          zIndex: 2,
        }}
      />
    </>
  )
}
