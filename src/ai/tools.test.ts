// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { AI_EDIT_ORIGIN } from '@/scene/undo'
import { listAiToolDefinitions, runAiTool, type AiToolContext } from '@/ai/tools'

function setup() {
  const api = createSceneAPI()
  // A fresh document has no root; the first frame created becomes it.
  api.createNode('frame', null, { name: 'Scene' })
  let selection: string[] = []
  const context: AiToolContext = {
    api,
    getSelection: () => selection,
    setSelection: (ids) => {
      selection = ids
    },
    getPlayhead: () => 0,
    setPlayhead: vi.fn(),
    setPlaying: vi.fn(),
  }
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const result = runAiTool(context, name, args)
    return { ...result, json: result.isError ? null : JSON.parse(result.text) }
  }
  return { api, context, call, getSelection: () => selection }
}

describe('AI tool definitions', () => {
  it('exposes unique, documented tools with object schemas', () => {
    const defs = listAiToolDefinitions()
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length)
    for (const def of defs) {
      expect(def.description.length).toBeGreaterThan(20)
      expect(def.inputSchema.type).toBe('object')
    }
  })
})

describe('get_scene', () => {
  it('lists layers, selection and existing animation', () => {
    const { api, call, context } = setup()
    const id = api.createNode('rect', api.getRoot(), { name: 'Card' })
    context.setSelection([id])
    const { json } = call('get_scene')
    expect(json.selection).toEqual([id])
    expect(json.nodes.some((n: { id: string; name: string }) => n.id === id && n.name === 'Card')).toBe(true)
    expect(json.duration).toBe(api.getMeta().duration)
  })
})

describe('animate_nodes', () => {
  it('staggers an entrance and animates back to the resting value', () => {
    const { api, call } = setup()
    const a = api.createNode('rect', api.getRoot(), { name: 'A' })
    const b = api.createNode('rect', api.getRoot(), { name: 'B' })
    const restingX = api.getNode(a)!.transform.x

    const { json, isError } = call('animate_nodes', {
      targets: [a, b],
      properties: [
        { property: 'appearance.opacity', from: 0, to: 1 },
        { property: 'transform.x', from: restingX + 80 },
      ],
      startTime: 0.2,
      duration: 0.5,
      stagger: 0.1,
      easing: 'ease-out',
    })
    expect(isError).toBeUndefined()
    expect(json.endsAt).toBeCloseTo(0.8)

    const opacityA = api.getTracksForNode(a).find((t) => t.propertyId === 'appearance.opacity')!
    expect(opacityA.keyframes.map((k) => [k.time, k.value])).toEqual([
      [0.2, 0],
      [0.7, 1],
    ])
    const opacityB = api.getTracksForNode(b).find((t) => t.propertyId === 'appearance.opacity')!
    expect(opacityB.keyframes[0].time).toBeCloseTo(0.3)
    const xA = api.getTracksForNode(a).find((t) => t.propertyId === 'transform.x')!
    expect(xA.keyframes[1].value).toBe(restingX)
    expect(xA.keyframes[0].easingOut).toBe('ease-out')
  })

  it('reports a missing layer as a tool error the model can read', () => {
    const { call } = setup()
    const result = call('animate_nodes', {
      targets: ['nope'],
      properties: [{ property: 'appearance.opacity', from: 0, to: 1 }],
      startTime: 0,
      duration: 1,
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('No node with id "nope"')
  })

  it('rejects properties it cannot animate', () => {
    const { api, call } = setup()
    const id = api.createNode('rect', api.getRoot())
    const result = call('animate_property', {
      nodeId: id,
      property: 'name',
      keyframes: [{ time: 0, value: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not an animatable property')
  })
})

describe('validate_scene', () => {
  it('flags keyframes after the scene ends and passes clean scenes', () => {
    const { api, call } = setup()
    const id = api.createNode('rect', api.getRoot())
    expect(call('validate_scene').json.ok).toBe(true)

    const end = api.getMeta().duration
    const animate = call('animate_property', {
      nodeId: id,
      property: 'appearance.opacity',
      keyframes: [{ time: end + 1, value: 1 }],
    })
    expect(animate.json.warnings).toHaveLength(1)
    const report = call('validate_scene').json
    expect(report.ok).toBe(false)
    expect(report.problems[0]).toContain('after the scene ends')
  })
})

describe('other tools', () => {
  it('creates, edits and deletes layers', () => {
    const { api, call, getSelection } = setup()
    const created = call('create_node', { kind: 'rect', props: { name: 'Badge' } })
    const id = created.json.id as string
    expect(api.getNode(id)?.name).toBe('Badge')
    expect(getSelection()).toEqual([id])

    call('set_node_properties', { nodeId: id, properties: { name: 'Pill' } })
    expect(api.getNode(id)?.name).toBe('Pill')
    expect(call('set_node_properties', { nodeId: id, properties: { kind: 'text' } }).isError).toBe(true)

    expect(call('delete_node', { nodeId: api.getRoot() }).isError).toBe(true)
    call('delete_node', { nodeId: id })
    expect(api.getNode(id)).toBeNull()
  })

  it('clears tracks and previews', () => {
    const { api, call, context } = setup()
    const id = api.createNode('rect', api.getRoot())
    call('animate_property', {
      nodeId: id,
      property: 'transform.x',
      keyframes: [{ time: 0, value: 0 }, { time: 1, value: 50 }],
    })
    expect(call('clear_animation', { nodeId: id, property: 'transform.x' }).json.removed).toBe(1)
    expect(api.getTracksForNode(id)).toHaveLength(0)

    call('preview', { time: 1.5, play: true })
    expect(context.setPlayhead).toHaveBeenCalledWith(1.5)
    expect(context.setPlaying).toHaveBeenLastCalledWith(true)
  })
})

describe('undo', () => {
  it('records assistant edits as undoable steps', () => {
    const { api, call } = setup()
    const scene = api.doc.getMap('scene')
    const manager = new Y.UndoManager(
      [scene, scene.get('nodes') as Y.Map<unknown>, scene.get('tracks') as Y.Map<unknown>],
      { trackedOrigins: new Set([null, AI_EDIT_ORIGIN]) },
    )
    const id = api.createNode('rect', api.getRoot())
    manager.stopCapturing()
    const before = manager.undoStack.length

    call('animate_property', {
      nodeId: id,
      property: 'transform.x',
      keyframes: [{ time: 0, value: 0 }, { time: 1, value: 50 }],
    })
    expect(api.getTracksForNode(id)).toHaveLength(1)
    expect(manager.undoStack.length).toBeGreaterThan(before)

    manager.undo()
    expect(api.getTracksForNode(id)).toHaveLength(0)
  })
})
