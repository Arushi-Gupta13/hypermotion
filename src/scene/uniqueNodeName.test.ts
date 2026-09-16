// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { uniqueNodeName } from './uniqueNodeName'

describe('uniqueNodeName', () => {
  it('returns the base name unchanged when nothing else uses it', () => {
    const api = createSceneAPI()
    expect(uniqueNodeName(api, 'Star')).toBe('Star')
  })

  it('appends an increasing number each time the name is already taken', () => {
    const api = createSceneAPI()
    api.createNode('vector', null, { name: 'Star' })
    expect(uniqueNodeName(api, 'Star')).toBe('Star 2')

    api.createNode('vector', null, { name: 'Star 2' })
    expect(uniqueNodeName(api, 'Star')).toBe('Star 3')
  })

  it('continues the same sequence rather than stacking suffixes when the source is already numbered', () => {
    const api = createSceneAPI()
    api.createNode('vector', null, { name: 'Star' })
    api.createNode('vector', null, { name: 'Star 2' })

    // Duplicating "Star 2" itself should produce "Star 3", not "Star 2 2".
    expect(uniqueNodeName(api, 'Star 2')).toBe('Star 3')
  })

  it('does not mistake an embedded number for a counter suffix', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'iPhone 13 Mockup' })
    expect(uniqueNodeName(api, 'iPhone 13 Mockup')).toBe('iPhone 13 Mockup 2')
  })

  it('jumps straight to the next number when the source name is already numbered — even "1" — instead of handing back the bare name first', () => {
    const api = createSceneAPI()
    api.createNode('vector', null, { name: 'Star 1' })

    // One duplicate of "Star 1" must directly produce "Star 2" — not
    // "Star" (which would only reach "Star 2" on a SECOND duplicate).
    expect(uniqueNodeName(api, 'Star 1')).toBe('Star 2')
  })

  it('keeps incrementing from a hand-typed number even with gaps in the sequence', () => {
    const api = createSceneAPI()
    api.createNode('vector', null, { name: 'Star 1' })
    api.createNode('vector', null, { name: 'Star 2' })

    expect(uniqueNodeName(api, 'Star 1')).toBe('Star 3')
  })

  it('scans the whole document, not just siblings', () => {
    const api = createSceneAPI()
    const parentA = api.createNode('frame', null, { name: 'A' })
    const parentB = api.createNode('frame', null, { name: 'B' })
    api.createNode('vector', parentA, { name: 'Star' })

    expect(uniqueNodeName(api, 'Star')).toBe('Star 2')
    void parentB
  })
})
