// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  duplicateNode,
  pasteClipboardItem,
  serializeSubtree,
} from './useKeyboardShortcuts'

describe('duplicate/paste naming', () => {
  it('gives each Cmd+D duplicate an increasing number instead of repeating the same name', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null)
    const starId = api.createNode('vector', rootId, { name: 'Star' })

    const dup1 = duplicateNode(api, starId)
    const dup2 = duplicateNode(api, starId)
    const dup3 = duplicateNode(api, starId)

    expect(api.getNode(dup1!)?.name).toBe('Star 2')
    expect(api.getNode(dup2!)?.name).toBe('Star 3')
    expect(api.getNode(dup3!)?.name).toBe('Star 4')
  })

  it('duplicating a duplicate continues the same sequence, not "Star 2 2"', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null)
    const starId = api.createNode('vector', rootId, { name: 'Star' })
    const dup1 = duplicateNode(api, starId)

    const dup2 = duplicateNode(api, dup1!)

    expect(api.getNode(dup2!)?.name).toBe('Star 3')
  })

  it('gives each Cmd+C/Cmd+V paste an increasing number too', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null)
    const starId = api.createNode('vector', rootId, { name: 'Star' })
    const clip = serializeSubtree(api, starId)!

    const paste1 = pasteClipboardItem(api, clip, rootId)
    const paste2 = pasteClipboardItem(api, clip, rootId)

    expect(api.getNode(paste1!)?.name).toBe('Star 2')
    expect(api.getNode(paste2!)?.name).toBe('Star 3')
  })
})
