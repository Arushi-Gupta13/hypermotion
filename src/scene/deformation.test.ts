// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from './doc'
import {
  DEFAULT_BEND_DEFORMATION,
  normalizeLayerDeformation,
} from './deformation'

describe('layer deformation persistence', () => {
  it('round-trips a bend on a normal node through the scene document', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', api.getRoot(), {
      deformation: {
        ...DEFAULT_BEND_DEFORMATION,
        angle: 72,
        captureOrigin: { x: 12, y: -8, z: 4 },
      },
    })
    expect(api.getNode(nodeId)?.deformation).toMatchObject({
      kind: 'bend',
      angle: 72,
      captureOrigin: { x: 12, y: -8, z: 4 },
    })
  })

  it('normalizes unsafe imported values without losing the effect', () => {
    expect(normalizeLayerDeformation({
      kind: 'bend',
      factor: 4,
      captureLength: -20,
      geometryDetail: 900,
      captureDirection: { x: Number.NaN, y: 1, z: 0 },
    })).toMatchObject({
      factor: 1,
      captureLength: 0,
      geometryDetail: 128,
      captureDirection: { x: 1, y: 1, z: 0 },
    })
  })
})
