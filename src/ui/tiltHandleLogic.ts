// SPDX-License-Identifier: Apache-2.0

import type { RenderMode } from '@/ui/multiRenderMode'

/**
 * Which `renderMode` to commit alongside a tilt-handle drag, so the new
 * rotationX/rotationY are actually guaranteed to render as a tilted plane —
 * see `shouldEmitPlane` in `src/render3d/scene3d.ts`, which only promotes a
 * NON-root-child node to its own tilt-capable plane when its own
 * `renderMode` is `'plane'` or `'group3d'` (root children auto-promote
 * regardless). `undefined` means "leave it alone": a node that's already
 * `'plane'`/`'group3d'`, or that's a root child relying on
 * `promoteRootChildren`, doesn't need — and shouldn't get — its render
 * mode silently rewritten by a drag.
 *
 * Deliberately conservative: this only ever promotes 'flat' → 'plane', the
 * least surprising direction (a flat layer that wasn't visibly tilting
 * starts tilting). It never demotes 'group3d' back to 'plane' or touches
 * anything already 3D-aware.
 */
export function renderModeForTiltCommit(
  currentRenderMode: RenderMode | undefined,
  isRootChild: boolean,
): RenderMode | undefined {
  if (isRootChild) return undefined
  if (currentRenderMode === undefined || currentRenderMode === 'flat') {
    return 'plane'
  }
  return undefined
}
