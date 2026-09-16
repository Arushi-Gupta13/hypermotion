// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { SolvedLayout } from '@/layout'
import { findDropTargetFrame, type DropInheritedAnim } from '@/ui/dropTargetFrame'

// A local identity stand-in, deliberately not imported from
// canvasRenderHelpers — that module pulls in the full render/persistence
// chain (IndexedDB, etc.), which is unnecessary weight for a pure
// geometry test and triggers noisy unhandled-rejection warnings under
// vitest's Node environment.
const IDENTITY_INHERITED: DropInheritedAnim = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
}

describe('findDropTargetFrame', () => {
  it('parents into a nested frame (e.g. a mockup screen) instead of root', () => {
    const api = createSceneAPI()
    const rootId = api.getRoot()!

    // Mockup outer frame at (100, 100), 300x600.
    const outerId = api.createNode('frame', rootId, {
      position: 'absolute',
      size: { width: 300, height: 600 },
      transform: { x: 100, y: 100, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    // Screen frame inset within the outer frame, local offset (20, 20).
    const screenId = api.createNode('frame', outerId, {
      position: 'absolute',
      size: { width: 260, height: 560 },
      transform: { x: 20, y: 20, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })

    const solved: SolvedLayout = {
      [outerId]: { x: 0, y: 0, width: 300, height: 600 },
      [screenId]: { x: 0, y: 0, width: 260, height: 560 },
    }
    const inherited: Record<string, DropInheritedAnim> = {
      [outerId]: IDENTITY_INHERITED,
      // Screen inherits the outer frame's absolute offset from its ancestor.
      [screenId]: { ...IDENTITY_INHERITED, x: 100, y: 100 },
    }

    // Absolute screen rect: (100+20, 100+20) to (380, 680).
    const result = findDropTargetFrame(api, solved, inherited, rootId, {
      x: 200,
      y: 300,
    })

    expect(result.parentId).toBe(screenId)
    expect(result.local).toEqual({ x: 200 - 120, y: 300 - 120 })
  })

  it('falls back to the root when the point is outside every frame', () => {
    const api = createSceneAPI()
    const rootId = api.getRoot()!
    const outerId = api.createNode('frame', rootId, {
      position: 'absolute',
      size: { width: 300, height: 600 },
      transform: { x: 100, y: 100, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    const solved: SolvedLayout = {
      [outerId]: { x: 0, y: 0, width: 300, height: 600 },
    }
    const inherited: Record<string, DropInheritedAnim> = { [outerId]: IDENTITY_INHERITED }

    const result = findDropTargetFrame(api, solved, inherited, rootId, {
      x: 5000,
      y: 5000,
    })

    expect(result).toEqual({ parentId: rootId, local: { x: 5000, y: 5000 } })
  })

  it('prefers the innermost of two nested containing frames', () => {
    const api = createSceneAPI()
    const rootId = api.getRoot()!
    const outerId = api.createNode('frame', rootId, {
      position: 'absolute',
      size: { width: 300, height: 600 },
      transform: { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    const innerId = api.createNode('frame', outerId, {
      position: 'absolute',
      size: { width: 100, height: 100 },
      transform: { x: 10, y: 10, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    const solved: SolvedLayout = {
      [outerId]: { x: 0, y: 0, width: 300, height: 600 },
      [innerId]: { x: 0, y: 0, width: 100, height: 100 },
    }
    const inherited: Record<string, DropInheritedAnim> = {
      [outerId]: IDENTITY_INHERITED,
      [innerId]: IDENTITY_INHERITED,
    }

    const result = findDropTargetFrame(api, solved, inherited, rootId, {
      x: 50,
      y: 50,
    })

    expect(result.parentId).toBe(innerId)
  })

  it('skips locked and hidden frames', () => {
    const api = createSceneAPI()
    const rootId = api.getRoot()!
    const lockedId = api.createNode('frame', rootId, {
      position: 'absolute',
      size: { width: 300, height: 600 },
      transform: { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
      locked: true,
    })
    const solved: SolvedLayout = {
      [lockedId]: { x: 0, y: 0, width: 300, height: 600 },
    }
    const inherited: Record<string, DropInheritedAnim> = { [lockedId]: IDENTITY_INHERITED }

    const result = findDropTargetFrame(api, solved, inherited, rootId, {
      x: 50,
      y: 50,
    })

    expect(result.parentId).toBe(rootId)
  })
})
