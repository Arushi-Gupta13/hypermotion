// SPDX-License-Identifier: Apache-2.0

import { useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { VectorNode, VectorPosition } from '@/scene'
import {
  cloneVectorDocument,
  isEditableVectorNode,
  listVectorEditHandles,
  moveVectorAnchor,
  moveVectorHandle,
  vectorLocalToViewBox,
  vectorViewBoxToLocal,
  type VectorEditPart,
} from '@/scene/vector'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { vectorEditPreviewStore } from '@/ui/vectorEditPreviewStore'
import {
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from '@/anim'

const HANDLE_HIT_PX = 10

export interface VectorEditProjection {
  clientToLocal: (clientX: number, clientY: number) => VectorPosition | null
  localToScreen: (local: VectorPosition) => VectorPosition
}

export function VectorEditOverlay({
  node,
  zoom,
  projection,
}: {
  node: VectorNode
  zoom: number
  projection: VectorEditProjection
}) {
  const api = useSceneAPI()
  const preview = useSyncExternalStore(
    vectorEditPreviewStore.subscribe,
    vectorEditPreviewStore.getSnapshot,
    vectorEditPreviewStore.getSnapshot,
  )
  const dragRef = useRef<{
    part: VectorEditPart
    vector: ReturnType<typeof cloneVectorDocument>
  } | null>(null)

  if (!isEditableVectorNode(node)) return null
  const vector = preview[node.id] ?? node.vector
  const size = { width: node.size.width, height: node.size.height }
  const width = typeof size.width === 'number' ? size.width : 1
  const height = typeof size.height === 'number' ? size.height : 1
  const localSize = { width, height }
  const handlePx = 7 / Math.max(zoom, 0.001)
  const stemWidth = 1 / Math.max(zoom, 0.001)

  const commit = (next: typeof vector, moved: boolean) => {
    vectorEditPreviewStore.clear()
    if (!moved) return
    const ui = useUI.getState()
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'vector', next)
      if (ui.recording) {
        recordKeyframesForPatch(api, node.id, ui.playhead, 'vector', {
          geometry: next,
        })
      } else {
        stampToActiveTracksForPatch(api, node.id, ui.playhead, 'vector', {
          geometry: next,
        })
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }

  const startDrag = (part: VectorEditPart, event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startVector = cloneVectorDocument(vector)
    dragRef.current = { part, vector: startVector }
    vectorEditPreviewStore.preview(node.id, startVector)
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const local = projection.clientToLocal(moveEvent.clientX, moveEvent.clientY)
      if (!local) return
      const view = vectorLocalToViewBox(node.viewBox, localSize, local)
      let next = startVector
      if (drag.part.kind === 'anchor') {
        next = moveVectorAnchor(
          startVector,
          drag.part.itemId,
          drag.part.pointId,
          view,
        )
      } else {
        const item = startVector.items.find((candidate) => candidate.id === drag.part.itemId)
        const segment = item?.geometry.segments[drag.part.segmentId]
        const anchorId =
          drag.part.which === 'start'
            ? segment?.startPointId
            : segment?.endPointId
        const handleMode =
          (anchorId && item?.geometry.points[anchorId]?.handleMode) ||
          'independent'
        next = moveVectorHandle(
          startVector,
          drag.part.itemId,
          drag.part.segmentId,
          drag.part.which,
          view,
          handleMode,
        )
      }
      drag.vector = next
      vectorEditPreviewStore.preview(node.id, next)
    }

    const finish = (cancel: boolean) => {
      const drag = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!drag) return
      if (cancel) {
        vectorEditPreviewStore.clear()
        return
      }
      commit(drag.vector, true)
    }
    const onUp = () => finish(false)
    const onCancel = () => finish(true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const dots: ReactNode[] = []
  for (const item of vector.items) {
    if (!item.visible) continue
    for (const handle of listVectorEditHandles(item)) {
      const anchorLocal = vectorViewBoxToLocal(
        node.viewBox,
        localSize,
        handle.anchor,
      )
      const controlLocal = vectorViewBoxToLocal(
        node.viewBox,
        localSize,
        handle.control,
      )
      const a = projection.localToScreen(anchorLocal)
      const c = projection.localToScreen(controlLocal)
      dots.push(
        <line
          key={`${item.id}-${handle.segmentId}-${handle.which}-stem`}
          x1={a.x}
          y1={a.y}
          x2={c.x}
          y2={c.y}
          stroke="var(--color-accent)"
          strokeWidth={stemWidth}
          pointerEvents="none"
        />,
        <circle
          key={`${item.id}-${handle.segmentId}-${handle.which}-handle`}
          cx={c.x}
          cy={c.y}
          r={handlePx * 0.45}
          fill="var(--color-panel)"
          stroke="var(--color-accent)"
          strokeWidth={stemWidth}
          style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(event) =>
            startDrag(
              {
                kind: 'handle',
                itemId: item.id,
                segmentId: handle.segmentId,
                which: handle.which,
              },
              event,
            )
          }
        />,
      )
    }
    for (const point of Object.values(item.geometry.points)) {
      const local = vectorViewBoxToLocal(node.viewBox, localSize, point)
      const screen = projection.localToScreen(local)
      dots.push(
        <circle
          key={`${item.id}-${point.id}`}
          cx={screen.x}
          cy={screen.y}
          r={handlePx * 0.55}
          fill="var(--color-accent)"
          stroke="var(--color-panel)"
          strokeWidth={stemWidth}
          style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(event) =>
            startDrag(
              { kind: 'anchor', itemId: item.id, pointId: point.id },
              event,
            )
          }
        />,
      )
    }
  }

  void HANDLE_HIT_PX

  return (
    <g data-vector-edit={node.id} className="pointer-events-none">
      {dots}
    </g>
  )
}
