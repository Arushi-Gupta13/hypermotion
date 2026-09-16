// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type { CameraNode, PropertyId, Track } from '@/scene'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import {
  applyCameraAnglePreset,
  CAMERA_ANGLE_PRESETS,
} from '@/ui/cameraAnglePresets'

function activeCamera(api: SceneAPI): CameraNode {
  const camera = api.getActiveCamera()
  if (!camera) throw new Error('Expected the test scene to have a camera')
  return camera
}

function trackFor(api: SceneAPI, propertyId: PropertyId): Track {
  const camera = activeCamera(api)
  const track = api
    .getTracksForNode(camera.id)
    .find((candidate) => candidate.propertyId === propertyId)
  if (!track) throw new Error(`Expected ${propertyId} track`)
  return track
}

describe('camera angle presets', () => {
  it('sets rotation to the named preset and leaves position/scale untouched', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)
    api.setNodeProperty(camera.id, 'transform', {
      ...camera.transform,
      x: 300,
      y: 150,
      z: -50,
      rotationX: 0,
      rotationY: 0,
      rotation: 0,
      scaleX: 1.2,
      scaleY: 1.2,
    })

    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    expect(
      applyCameraAnglePreset(api, camera.id, 'three-quarter-left', 0.75),
    ).toBe(true)

    expect(activeCamera(api).transform).toEqual({
      ...camera.transform,
      x: 300,
      y: 150,
      z: -50,
      rotationX: 8,
      rotationY: -25,
      rotation: 0,
      scaleX: 1.2,
      scaleY: 1.2,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(trackFor(api, 'transform.rotationX').keyframes).toEqual([
      expect.objectContaining({ time: 0.75, value: 8 }),
    ])
    expect(trackFor(api, 'transform.rotationY').keyframes).toEqual([
      expect.objectContaining({ time: 0.75, value: -25 }),
    ])
    expect(trackFor(api, 'transform.rotation').keyframes).toEqual([
      expect.objectContaining({ time: 0.75, value: 0 }),
    ])
    unsubscribe()
  })

  it('updates an existing keyframe at the playhead instead of duplicating it', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)
    const rotXTrack: Track = {
      id: 'camera-rotx',
      nodeId: camera.id,
      propertyId: 'transform.rotationX',
      defaultEasing: 'ease-in-out',
      keyframes: [
        { id: 'rx-old', time: 0, value: 0 },
        {
          id: 'rx-at-playhead',
          time: 2.005,
          value: 12,
          easingOut: 'ease-out',
          presetOrigin: 'in',
        },
      ],
    }
    api.setTrack(rotXTrack)

    applyCameraAnglePreset(api, camera.id, 'top-down', 2)

    const next = api.getTrack(rotXTrack.id)!
    expect(next.keyframes).toEqual([
      rotXTrack.keyframes[0],
      { ...rotXTrack.keyframes[1], time: 2, value: 55 },
    ])
    expect(next.keyframes[1]).toMatchObject({
      id: 'rx-at-playhead',
      easingOut: 'ease-out',
      presetOrigin: 'in',
    })
  })

  it('every preset id in the table round-trips through apply', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)
    for (const preset of CAMERA_ANGLE_PRESETS) {
      expect(applyCameraAnglePreset(api, camera.id, preset.id, 0)).toBe(true)
      expect(activeCamera(api).transform).toMatchObject({
        rotationX: preset.rotationX,
        rotationY: preset.rotationY,
        rotation: preset.rotation,
      })
    }
  })

  it('does nothing for missing and non-camera node ids', () => {
    const api = createSceneAPI()
    const rectId = api.createNode('rect', null)
    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)

    expect(applyCameraAnglePreset(api, 'missing', 'front', 1)).toBe(false)
    expect(applyCameraAnglePreset(api, rectId, 'front', 1)).toBe(false)

    expect(listener).not.toHaveBeenCalled()
    expect(api.getTracksForNode(rectId)).toEqual([])
    unsubscribe()
  })
})
