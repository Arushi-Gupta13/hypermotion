// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { findTrack } from './tracks'
import {
  toggleStaggerSetPropertyKeyframes,
  type StaggerAuthoringOptions,
} from './staggerSets'
import { resetBendNodes } from './bendReset'

describe('reset Bend', () => {
  it('restores neutral 3D defaults and removes only Bend animation', () => {
    const api = createSceneAPI()
    const rootId = api.getRoot()
    const layerIds = [
      api.createNode('rect', rootId),
      api.createNode('rect', rootId),
    ]
    const options: StaggerAuthoringOptions = {
      setId: 'bend-stagger',
      layerIds,
      delay: 0.1,
      order: 'forward',
    }
    toggleStaggerSetPropertyKeyframes(
      api,
      layerIds.map((nodeId) => ({ nodeId, currentValue: 90 })),
      'deformation.bend.angle',
      1,
      options,
    )
    api.setTrack({
      id: 'unrelated-opacity',
      nodeId: layerIds[0]!,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [{ id: 'opacity-key', time: 0, value: 1 }],
    })

    resetBendNodes(api, layerIds)

    for (const nodeId of layerIds) {
      expect(api.getNode(nodeId)?.deformation).toMatchObject({
        kind: 'bend',
        angle: 0,
        upDirection: { x: 0, y: 0, z: 1 },
        surfaceShading: true,
        depthAware: true,
      })
      expect(findTrack(api, nodeId, 'deformation.bend.angle')).toBeNull()
    }
    expect(findTrack(api, layerIds[0]!, 'appearance.opacity')).not.toBeNull()
    expect(api.getUiState().staggerSets['bend-stagger']).toBeUndefined()
  })
})
