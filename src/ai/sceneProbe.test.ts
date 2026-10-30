// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { addKeyframe } from '@/anim/tracks'
import { diffSnapshots, snapshotTracks } from '@/ai/sceneProbe'

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { name: 'Scene' })
  const title = api.createNode('rect', root, { name: 'Title' })
  const body = api.createNode('rect', root, { name: 'Body' })
  return { api, title, body }
}

describe('scene probe', () => {
  it('reports nothing when the animation did not change', () => {
    const { api, title } = setup()
    addKeyframe(api, title, 'appearance.opacity', 0, 0)
    expect(diffSnapshots(snapshotTracks(api), snapshotTracks(api))).toEqual([])
  })

  it('lists layers with new, edited and removed tracks, by name', () => {
    const { api, title, body } = setup()
    addKeyframe(api, title, 'appearance.opacity', 0, 0)
    addKeyframe(api, body, 'transform.y', 0, 40)
    const before = snapshotTracks(api)

    addKeyframe(api, title, 'appearance.opacity', 0.5, 1) // edited track
    addKeyframe(api, title, 'transform.y', 0, 20) // new track on the same layer
    api.deleteTrack(api.getTracksForNode(body)[0].id) // removed track

    const changes = diffSnapshots(before, snapshotTracks(api))
    expect(changes).toEqual([
      { nodeId: body, name: 'Body', tracks: 1, properties: ['transform.y'], present: false },
      {
        nodeId: title,
        name: 'Title',
        tracks: 2,
        properties: ['appearance.opacity', 'transform.y'],
        present: true,
      },
    ])
  })

  it('notices a changed value or easing on an existing keyframe', () => {
    const { api, title } = setup()
    addKeyframe(api, title, 'appearance.opacity', 0, 0)
    const before = snapshotTracks(api)
    addKeyframe(api, title, 'appearance.opacity', 0, 0, 'ease-out')
    expect(diffSnapshots(before, snapshotTracks(api))).toHaveLength(1)
  })
})
