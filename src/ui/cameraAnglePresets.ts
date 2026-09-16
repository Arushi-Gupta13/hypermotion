// SPDX-License-Identifier: Apache-2.0

import { addKeyframe, findTrack } from '@/anim'
import type { NodeId, PropertyId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'

/**
 * One-click cinematic camera angles — a small, named set of rotation
 * poses (tilt / roll) so framing a shot doesn't require hand-tuning
 * three rotation sliders. Position and zoom are left untouched; these
 * only set the camera's look direction and roll.
 */
export type CameraAnglePresetId =
  | 'front'
  | 'three-quarter-left'
  | 'three-quarter-right'
  | 'top-down'
  | 'low-hero'
  | 'dutch-tilt'

export interface CameraAnglePreset {
  id: CameraAnglePresetId
  label: string
  rotationX: number
  rotationY: number
  rotation: number
}

export const CAMERA_ANGLE_PRESETS: CameraAnglePreset[] = [
  { id: 'front', label: 'Front', rotationX: 0, rotationY: 0, rotation: 0 },
  { id: 'three-quarter-left', label: '3/4 Left', rotationX: 8, rotationY: -25, rotation: 0 },
  { id: 'three-quarter-right', label: '3/4 Right', rotationX: 8, rotationY: 25, rotation: 0 },
  { id: 'top-down', label: 'Top Down', rotationX: 55, rotationY: 0, rotation: 0 },
  { id: 'low-hero', label: 'Low Hero', rotationX: -18, rotationY: 0, rotation: 0 },
  { id: 'dutch-tilt', label: 'Dutch Tilt', rotationX: 0, rotationY: 15, rotation: 8 },
]

const KEYFRAME_TIME_EPSILON = 0.01

/**
 * Upsert a keyframe at `playhead` while retaining metadata on one already
 * there. Mirrors the equivalent private helper in cameraReset.ts — kept
 * separate rather than shared since each call site's semantics (reset to
 * zero vs. jump to a named pose) differ enough that a shared abstraction
 * would need its own parameterization for no real benefit at this size.
 */
function upsertTransformKeyframe(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  playhead: number,
  value: number,
): void {
  const track = findTrack(api, nodeId, propertyId)
  const existing = track?.keyframes.find(
    (keyframe) => Math.abs(keyframe.time - playhead) < KEYFRAME_TIME_EPSILON,
  )

  if (!track || !existing) {
    addKeyframe(api, nodeId, propertyId, playhead, value)
    return
  }

  const keyframes = track.keyframes
    .map((keyframe) =>
      keyframe.id === existing.id
        ? { ...keyframe, time: playhead, value }
        : keyframe,
    )
    .sort((a, b) => a.time - b.time)
  api.setTrack({ ...track, keyframes })
}

/**
 * Jump the camera to a named cinematic angle and stamp its three rotation
 * axes at the given playhead, in one undo step. Composes with existing
 * camera animation the same way resetCameraTransformGroup does — it
 * updates a keyframe already at the playhead rather than adding a
 * duplicate, and creates one when none exists yet.
 */
export function applyCameraAnglePreset(
  api: SceneAPI,
  cameraId: NodeId,
  presetId: CameraAnglePresetId,
  playhead: number,
): boolean {
  const preset = CAMERA_ANGLE_PRESETS.find((p) => p.id === presetId)
  const candidate = api.getNode(cameraId)
  if (!preset || !candidate || candidate.kind !== 'camera') return false

  api.doc.transact(() => {
    const camera = api.getNode(cameraId)
    if (!camera || camera.kind !== 'camera') return

    api.setNodeProperty(cameraId, 'transform', {
      ...camera.transform,
      rotationX: preset.rotationX,
      rotationY: preset.rotationY,
      rotation: preset.rotation,
    })

    upsertTransformKeyframe(api, cameraId, 'transform.rotationX', playhead, preset.rotationX)
    upsertTransformKeyframe(api, cameraId, 'transform.rotationY', playhead, preset.rotationY)
    upsertTransformKeyframe(api, cameraId, 'transform.rotation', playhead, preset.rotation)
  })

  return true
}
