// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { renderModeForTiltCommit } from '@/ui/tiltHandleLogic'

describe('renderModeForTiltCommit', () => {
  it('promotes a flat, non-root-child node to plane', () => {
    expect(renderModeForTiltCommit('flat', false)).toBe('plane')
  })

  it('promotes an undefined (default) render mode to plane', () => {
    expect(renderModeForTiltCommit(undefined, false)).toBe('plane')
  })

  it('leaves an already-plane node alone', () => {
    expect(renderModeForTiltCommit('plane', false)).toBeUndefined()
  })

  it('leaves an already-group3d node alone', () => {
    expect(renderModeForTiltCommit('group3d', false)).toBeUndefined()
  })

  it('leaves a root child alone even if flat — it auto-promotes via promoteRootChildren', () => {
    expect(renderModeForTiltCommit('flat', true)).toBeUndefined()
    expect(renderModeForTiltCommit(undefined, true)).toBeUndefined()
  })
})
