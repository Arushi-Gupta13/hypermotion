// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'

/**
 * Independent proof of what a turn changed. The panel compares the scene's
 * animation tracks before and after a turn, so what it reports comes from the
 * document itself, not from the model's own account of what it did.
 */

export interface SceneChange {
  nodeId: string
  name: string
  /** Tracks created, edited or removed on this layer. */
  tracks: number
  /** Number of properties touched, in a stable order, for display. */
  properties: string[]
  /** False when the layer no longer has any animation (or no longer exists). */
  present: boolean
}

/** nodeId -> { name, track signatures keyed by property }. */
export type TrackSnapshot = Map<string, { name: string; tracks: Map<string, string> }>

export function snapshotTracks(api: SceneAPI): TrackSnapshot {
  const snapshot: TrackSnapshot = new Map()
  for (const track of api.getAllTracks()) {
    const entry = snapshot.get(track.nodeId) ?? {
      name: api.getNode(track.nodeId)?.name ?? track.nodeId,
      tracks: new Map<string, string>(),
    }
    entry.tracks.set(
      track.propertyId,
      track.keyframes.map((kf) => `${kf.time}=${JSON.stringify(kf.value)}~${JSON.stringify(kf.easingOut ?? null)}`).join('|'),
    )
    snapshot.set(track.nodeId, entry)
  }
  return snapshot
}

export function diffSnapshots(before: TrackSnapshot, after: TrackSnapshot): SceneChange[] {
  const changes: SceneChange[] = []
  const ids = new Set([...before.keys(), ...after.keys()])
  for (const nodeId of ids) {
    const was = before.get(nodeId)
    const now = after.get(nodeId)
    const properties = new Set([...(was?.tracks.keys() ?? []), ...(now?.tracks.keys() ?? [])])
    const touched = [...properties].filter((property) => was?.tracks.get(property) !== now?.tracks.get(property))
    if (touched.length === 0) continue
    changes.push({
      nodeId,
      name: now?.name ?? was?.name ?? nodeId,
      tracks: touched.length,
      properties: touched.sort(),
      present: now !== undefined,
    })
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name))
}

// The scene API lives in React context, so the bridge hook registers a reader
// here for the store, which sits outside React.
let probe: (() => TrackSnapshot) | null = null

export function registerSceneProbe(next: (() => TrackSnapshot) | null): void {
  probe = next
}

export function readSceneTracks(): TrackSnapshot | null {
  return probe ? probe() : null
}
