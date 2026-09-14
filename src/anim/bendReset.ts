// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_BEND_DEFORMATION } from '@/scene/deformation'
import type { BendDeformation, NodeId } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { pruneStaggerMembershipForRemovedKeyframe } from './staggerSets'
import { removeTrack } from './tracks'

export function neutralBendDeformation(): BendDeformation {
  return {
    ...DEFAULT_BEND_DEFORMATION,
    captureDirection: { ...DEFAULT_BEND_DEFORMATION.captureDirection },
    upDirection: { ...DEFAULT_BEND_DEFORMATION.upDirection },
    captureOrigin: { ...DEFAULT_BEND_DEFORMATION.captureOrigin },
    angle: 0,
  }
}

/** Remove only Bend animation and its stagger references from one layer. */
export function clearBendAnimation(api: SceneAPI, nodeId: NodeId) {
  for (const track of api.getTracksForNode(nodeId)) {
    if (!track.propertyId.startsWith('deformation.bend.')) continue
    for (const keyframe of track.keyframes) {
      pruneStaggerMembershipForRemovedKeyframe(
        api,
        nodeId,
        track.propertyId,
        keyframe.id,
      )
    }
    removeTrack(api, track.id)
  }
}

/** Reset one or more bends as one undoable editor action. */
export function resetBendNodes(api: SceneAPI, nodeIds: readonly NodeId[]) {
  api.doc.transact(() => {
    for (const nodeId of nodeIds) {
      if (!api.getNode(nodeId)) continue
      api.setNodeProperty(nodeId, 'deformation', neutralBendDeformation())
      clearBendAnimation(api, nodeId)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}
