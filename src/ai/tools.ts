// SPDX-License-Identifier: Apache-2.0

/**
 * Live-canvas tools for the AI assistant.
 *
 * Claude Code (run by the main process) calls these over MCP; the renderer
 * executes them on the open scene. They sit on the same primitives the editor
 * itself uses (`addKeyframe`, `setNodeProperty`, `createNode`), so everything
 * they do shows up on the timeline and is undoable.
 */

import { addKeyframe, findTrack, removeTrack } from '@/anim/tracks'
import { AI_EDIT_ORIGIN } from '@/scene/undo'
import type { SceneAPI } from '@/scene/doc'
import type {
  EasingKind,
  KeyframeValue,
  Node,
  NodeId,
  PropertyId,
} from '@/scene/types'

export interface AiToolContext {
  api: SceneAPI
  /** Current editor selection (node ids). */
  getSelection: () => string[]
  setSelection: (ids: string[]) => void
  getPlayhead: () => number
  setPlayhead: (time: number) => void
  setPlaying: (playing: boolean) => void
}

export interface AiTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** True when the tool changes the scene (wrapped in one undoable transaction). */
  mutates: boolean
  run: (context: AiToolContext, args: Record<string, unknown>) => unknown
}

/** Numeric properties the assistant may animate. */
const NUMERIC_PROPERTIES = new Set<string>([
  'transform.x',
  'transform.y',
  'transform.z',
  'transform.rotation',
  'transform.rotationX',
  'transform.rotationY',
  'transform.scaleX',
  'transform.scaleY',
  'transform.anchorX',
  'transform.anchorY',
  'transform.anchorZ',
  'motionPath.progress',
  'appearance.opacity',
  'appearance.cornerRadius',
  'shape.arcStart',
  'shape.arcSweep',
  'shape.arcInnerRadius',
  'text.progress',
  'layout.gap',
  'layout.padding.top',
  'layout.padding.right',
  'layout.padding.bottom',
  'layout.padding.left',
  'size.width',
  'size.height',
  'camera.focusDistance',
  'camera.pointOfInterestX',
  'camera.pointOfInterestY',
  'camera.pointOfInterestZ',
  'camera.focalLength',
  'camera.fieldOfView',
  'camera.nearClip',
  'camera.farClip',
  'camera.aperture',
  'camera.fStop',
  'camera.blurLevel',
  'camera.chromaticAberrationAmount',
  'camera.bloomStrength',
  'camera.bloomRadius',
  'camera.bloomThreshold',
  'camera.vhsIntensity',
])

const STRING_PROPERTIES = new Set<string>(['appearance.fill'])

const NAMED_EASINGS = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out'])

const EASING_SCHEMA = {
  description:
    'Easing of the segment leaving each keyframe: "linear", "ease-in", "ease-out", "ease-in-out", {"bezier":[x1,y1,x2,y2]} or {"spring":{"stiffness":n,"damping":n,"mass":n}}.',
  oneOf: [
    { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
    {
      type: 'object',
      properties: {
        bezier: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
      },
      required: ['bezier'],
    },
    {
      type: 'object',
      properties: {
        spring: {
          type: 'object',
          properties: {
            stiffness: { type: 'number' },
            damping: { type: 'number' },
            mass: { type: 'number' },
          },
          required: ['stiffness', 'damping', 'mass'],
        },
      },
      required: ['spring'],
    },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireNode(api: SceneAPI, nodeId: unknown): Node {
  if (typeof nodeId !== 'string') throw new Error('nodeId must be a string.')
  const node = api.getNode(nodeId)
  if (!node) {
    throw new Error(`No node with id "${nodeId}". Call get_scene to list valid ids.`)
  }
  return node
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function parseEasing(value: unknown): EasingKind | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    if (NAMED_EASINGS.has(value)) return value as EasingKind
    throw new Error(`Unknown easing "${value}".`)
  }
  if (typeof value === 'object') {
    const candidate = value as { bezier?: unknown; spring?: Record<string, unknown> }
    if (Array.isArray(candidate.bezier) && candidate.bezier.length === 4) {
      const [a, b, c, d] = candidate.bezier.map((n) => requireNumber(n, 'bezier value'))
      return { bezier: [a, b, c, d] }
    }
    if (candidate.spring) {
      return {
        spring: {
          stiffness: requireNumber(candidate.spring.stiffness, 'spring.stiffness'),
          damping: requireNumber(candidate.spring.damping, 'spring.damping'),
          mass: requireNumber(candidate.spring.mass, 'spring.mass'),
        },
      }
    }
  }
  throw new Error('Invalid easing.')
}

function requireProperty(value: unknown): PropertyId {
  if (
    typeof value !== 'string' ||
    !(NUMERIC_PROPERTIES.has(value) || STRING_PROPERTIES.has(value))
  ) {
    throw new Error(
      `"${String(value)}" is not an animatable property. Use one of: ${[
        ...NUMERIC_PROPERTIES,
        ...STRING_PROPERTIES,
      ].join(', ')}.`,
    )
  }
  return value as PropertyId
}

function coerceValue(property: PropertyId, value: unknown): KeyframeValue {
  if (STRING_PROPERTIES.has(property)) {
    if (typeof value !== 'string') throw new Error(`${property} takes a color string like "#ff3366".`)
    return value
  }
  return requireNumber(value, `${property} value`)
}

/** Resting value of a property on a node, when it is a plain number. */
function currentValue(node: Node, property: PropertyId): number | undefined {
  const [group, key] = property.split('.', 2) as [string, string]
  const source = (node as unknown as Record<string, unknown>)[group]
  if (group === 'transform' || group === 'appearance') {
    const value = (source as Record<string, unknown> | undefined)?.[key]
    return typeof value === 'number' ? value : undefined
  }
  if (group === 'size') {
    const value = (source as Record<string, unknown> | undefined)?.[key]
    if (typeof value === 'number') return value
    // Sizes can be { mode, value } objects (fixed / hug / fill).
    const inner = (value as { value?: unknown } | undefined)?.value
    return typeof inner === 'number' ? inner : undefined
  }
  return undefined
}

function describeNode(api: SceneAPI, node: Node, depth: number) {
  const tracks = api.getTracksForNode(node.id).map((track) => ({
    property: track.propertyId,
    keyframes: track.keyframes.length,
    from: track.keyframes[0]?.time,
    to: track.keyframes[track.keyframes.length - 1]?.time,
  }))
  const summary: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    kind: node.kind,
    depth,
    parent: node.parent,
    x: round(node.transform.x),
    y: round(node.transform.y),
    opacity: round(node.appearance.opacity),
  }
  const size = (node as unknown as { size?: unknown }).size
  if (size) summary.size = size
  if (node.kind === 'text') summary.text = clip(node.text, 80)
  if (!node.visible) summary.hidden = true
  if (tracks.length > 0) summary.tracks = tracks
  return summary
}

const round = (value: number) => Math.round(value * 100) / 100
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value

const MAX_NODES = 300

function collectHierarchy(api: SceneAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const visit = (id: NodeId, depth: number) => {
    if (out.length >= MAX_NODES) return
    const node = api.getNode(id)
    if (!node) return
    out.push(describeNode(api, node, depth))
    for (const child of api.getChildren(id)) visit(child.id, depth + 1)
  }
  const root = api.getRoot()
  if (root) visit(root, 0)
  // Cameras and workspace items are scene-level, outside the root's tree.
  for (const id of api.getAllNodeIds()) {
    if (out.length >= MAX_NODES) break
    const node = api.getNode(id)
    if (node && node.parent === null && node.id !== root) {
      out.push(describeNode(api, node, 0))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getScene: AiTool = {
  name: 'get_scene',
  mutates: false,
  description:
    'Read the open scene: canvas size, duration, frame rate, the current selection, the active camera and the full layer hierarchy with each layer\'s position, size, opacity, text and existing animation tracks. Call this first, and again after edits to confirm them.',
  inputSchema: { type: 'object', properties: {} },
  run: ({ api, getSelection, getPlayhead }) => {
    const meta = api.getMeta()
    return {
      canvas: meta.canvas,
      duration: meta.duration,
      frameRate: meta.frameRate,
      playhead: round(getPlayhead()),
      selection: getSelection(),
      activeCameraId: api.getActiveCameraId(),
      nodes: collectHierarchy(api),
    }
  },
}

const getNode: AiTool = {
  name: 'get_node',
  mutates: false,
  description:
    'Read one layer in full: its transform, appearance, layout, text styling and every animation track with each keyframe (id, time, value, easing).',
  inputSchema: {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId'],
  },
  run: ({ api }, args) => {
    const node = requireNode(api, args.nodeId)
    return {
      node,
      tracks: api.getTracksForNode(node.id).map((track) => ({
        id: track.id,
        property: track.propertyId,
        defaultEasing: track.defaultEasing,
        keyframes: track.keyframes.map((kf) => ({
          id: kf.id,
          time: kf.time,
          value: kf.value,
          easing: kf.easingOut,
        })),
      })),
    }
  },
}

const setNodeProperties: AiTool = {
  name: 'set_node_properties',
  mutates: true,
  description:
    'Set static (non-animated) properties on a layer. `properties` maps a node field to its new value, e.g. {"name":"Hero card","text":"Welcome","fontSize":32,"visible":true} or a whole object for grouped fields such as "transform" ({"x":100,"y":40,"rotation":0,...}) or "appearance". Use get_node first to see the exact shape of grouped fields; pass the complete object when setting one.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      properties: { type: 'object', additionalProperties: true },
    },
    required: ['nodeId', 'properties'],
  },
  run: ({ api }, args) => {
    const node = requireNode(api, args.nodeId)
    const properties = args.properties
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      throw new Error('properties must be an object.')
    }
    const blocked = new Set(['id', 'kind', 'parent', 'children'])
    const applied: string[] = []
    for (const [key, value] of Object.entries(properties)) {
      if (blocked.has(key)) {
        throw new Error(`"${key}" cannot be changed with set_node_properties.`)
      }
      if (!(key in node)) {
        throw new Error(`"${key}" is not a property of a ${node.kind} layer.`)
      }
      api.setNodeProperty(node.id, key as never, value as never)
      applied.push(key)
    }
    return { nodeId: node.id, applied }
  },
}

const animateProperty: AiTool = {
  name: 'animate_property',
  mutates: true,
  description:
    'Write keyframes for one property of one layer. Keyframe values are absolute (e.g. transform.x in canvas pixels, appearance.opacity 0-1, transform.rotation in degrees). A keyframe at an existing time replaces it. Properties: transform.x/y/z/rotation/rotationX/rotationY/scaleX/scaleY, appearance.opacity/cornerRadius/fill (hex string), size.width/height, motionPath.progress, text.progress, layout.gap/padding.*, and camera.* (focalLength, fieldOfView, pointOfInterestX/Y/Z, blurLevel, bloomStrength, ...) on camera layers.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      property: { type: 'string' },
      keyframes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            time: { type: 'number', description: 'Seconds from the start of the scene.' },
            value: { description: 'Number (or hex color string for appearance.fill).' },
            easing: EASING_SCHEMA,
          },
          required: ['time', 'value'],
        },
      },
    },
    required: ['nodeId', 'property', 'keyframes'],
  },
  run: ({ api }, args) => {
    const node = requireNode(api, args.nodeId)
    const property = requireProperty(args.property)
    if (!Array.isArray(args.keyframes) || args.keyframes.length === 0) {
      throw new Error('keyframes must be a non-empty array.')
    }
    const duration = api.getMeta().duration
    const warnings: string[] = []
    for (const raw of args.keyframes as Record<string, unknown>[]) {
      const time = requireNumber(raw.time, 'keyframe time')
      if (time < 0) throw new Error('Keyframe times cannot be negative.')
      if (time > duration) {
        warnings.push(
          `Keyframe at ${time}s is after the scene ends (${duration}s). Raise the duration with set_scene_meta or move it earlier.`,
        )
      }
      addKeyframe(api, node.id, property, time, coerceValue(property, raw.value), parseEasing(raw.easing))
    }
    return { nodeId: node.id, property, keyframes: args.keyframes.length, warnings }
  },
}

const animateNodes: AiTool = {
  name: 'animate_nodes',
  mutates: true,
  description:
    'Animate several layers with the same motion, optionally staggered, e.g. cards sliding in one after another. For each target i, each property goes from `from` to `to` starting at startTime + i * stagger and lasting `duration`. Omit `to` to animate back to the layer\'s current resting value (the usual way to write an entrance); `from` is then the off-state (e.g. opacity 0, or transform.x resting + 80). Order of `targets` is the order of the stagger.',
  inputSchema: {
    type: 'object',
    properties: {
      targets: { type: 'array', items: { type: 'string' }, minItems: 1 },
      properties: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            property: { type: 'string' },
            from: { description: 'Value at the start of the motion. Defaults to the current resting value.' },
            to: { description: 'Value at the end. Defaults to the current resting value.' },
          },
          required: ['property'],
        },
      },
      startTime: { type: 'number' },
      duration: { type: 'number', description: 'Seconds each layer takes.' },
      stagger: { type: 'number', description: 'Seconds between consecutive layers. Default 0.' },
      easing: EASING_SCHEMA,
    },
    required: ['targets', 'properties', 'startTime', 'duration'],
  },
  run: ({ api }, args) => {
    const targets = args.targets
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error('targets must be a non-empty array of node ids.')
    }
    if (!Array.isArray(args.properties) || args.properties.length === 0) {
      throw new Error('properties must be a non-empty array.')
    }
    const startTime = requireNumber(args.startTime, 'startTime')
    const duration = requireNumber(args.duration, 'duration')
    if (startTime < 0 || duration <= 0) {
      throw new Error('startTime must be >= 0 and duration > 0.')
    }
    const stagger = args.stagger === undefined ? 0 : requireNumber(args.stagger, 'stagger')
    const easing = parseEasing(args.easing)
    const nodes = targets.map((id) => requireNode(api, id))
    const sceneDuration = api.getMeta().duration
    const lastEnd = startTime + (nodes.length - 1) * stagger + duration
    for (const [index, node] of nodes.entries()) {
      const begin = startTime + index * stagger
      for (const raw of args.properties as Record<string, unknown>[]) {
        const property = requireProperty(raw.property)
        const resting = currentValue(node, property)
        const from = raw.from ?? resting
        const to = raw.to ?? resting
        if (from === undefined || to === undefined) {
          throw new Error(
            `Give both from and to for ${property} on "${node.name}": it has no numeric resting value to default to.`,
          )
        }
        addKeyframe(api, node.id, property, begin, coerceValue(property, from), easing)
        addKeyframe(api, node.id, property, begin + duration, coerceValue(property, to), easing)
      }
    }
    return {
      animated: nodes.map((node) => node.name),
      endsAt: round(lastEnd),
      warnings:
        lastEnd > sceneDuration
          ? [`The last animation ends at ${round(lastEnd)}s but the scene is ${sceneDuration}s long.`]
          : [],
    }
  },
}

const clearAnimation: AiTool = {
  name: 'clear_animation',
  mutates: true,
  description:
    'Remove animation from a layer: one property\'s track if `property` is given, otherwise every track on the layer.',
  inputSchema: {
    type: 'object',
    properties: { nodeId: { type: 'string' }, property: { type: 'string' } },
    required: ['nodeId'],
  },
  run: ({ api }, args) => {
    const node = requireNode(api, args.nodeId)
    if (typeof args.property === 'string') {
      const track = findTrack(api, node.id, args.property as PropertyId)
      if (!track) return { removed: 0 }
      removeTrack(api, track.id)
      return { removed: 1 }
    }
    const tracks = api.getTracksForNode(node.id)
    for (const track of tracks) removeTrack(api, track.id)
    return { removed: tracks.length }
  },
}

const createNode: AiTool = {
  name: 'create_node',
  mutates: true,
  description:
    'Create a layer: kind "frame", "rect", "ellipse" or "text". `parentId` defaults to the scene root. `props` may set initial fields such as {"name":"Badge","text":"New","transform":{...},"size":{...}}; check an existing layer with get_node for the shape. Returns the new id.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['frame', 'rect', 'ellipse', 'text'] },
      parentId: { type: 'string' },
      props: { type: 'object', additionalProperties: true },
    },
    required: ['kind'],
  },
  run: ({ api, setSelection }, args) => {
    const kind = args.kind
    if (kind !== 'frame' && kind !== 'rect' && kind !== 'ellipse' && kind !== 'text') {
      throw new Error('kind must be frame, rect, ellipse or text.')
    }
    const parent = args.parentId === undefined ? api.getRoot() : requireNode(api, args.parentId).id
    const props =
      typeof args.props === 'object' && args.props !== null ? (args.props as never) : undefined
    const id = api.createNode(kind, parent, props)
    setSelection([id])
    return { id }
  },
}

const deleteNode: AiTool = {
  name: 'delete_node',
  mutates: true,
  description: 'Delete a layer (and its children and animation). The scene root cannot be deleted.',
  inputSchema: {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId'],
  },
  run: ({ api }, args) => {
    const node = requireNode(api, args.nodeId)
    if (node.id === api.getRoot()) throw new Error('The scene root cannot be deleted.')
    api.deleteNode(node.id)
    return { deleted: node.name }
  },
}

const setSceneMeta: AiTool = {
  name: 'set_scene_meta',
  mutates: true,
  description: 'Change the scene duration (seconds) and/or frame rate.',
  inputSchema: {
    type: 'object',
    properties: {
      duration: { type: 'number', minimum: 0.1 },
      frameRate: { type: 'number', minimum: 1, maximum: 240 },
    },
  },
  run: ({ api }, args) => {
    const patch: { duration?: number; frameRate?: number } = {}
    if (args.duration !== undefined) patch.duration = Math.max(0.1, requireNumber(args.duration, 'duration'))
    if (args.frameRate !== undefined) {
      patch.frameRate = Math.min(240, Math.max(1, Math.round(requireNumber(args.frameRate, 'frameRate'))))
    }
    api.setMeta(patch)
    return patch
  },
}

const selectNodes: AiTool = {
  name: 'select_nodes',
  mutates: false,
  description: 'Select layers in the editor so the user can see what you are working on.',
  inputSchema: {
    type: 'object',
    properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
    required: ['nodeIds'],
  },
  run: ({ api, setSelection }, args) => {
    if (!Array.isArray(args.nodeIds)) throw new Error('nodeIds must be an array.')
    const ids = args.nodeIds.map((id) => requireNode(api, id).id)
    setSelection(ids)
    return { selected: ids }
  },
}

const validateScene: AiTool = {
  name: 'validate_scene',
  mutates: false,
  description:
    'Check the scene for problems after edits: tracks pointing at missing layers, keyframes beyond the scene duration, duplicate times, off-screen end states and empty tracks. Returns { ok, problems }. Run this before telling the user you are done.',
  inputSchema: { type: 'object', properties: {} },
  run: ({ api }) => {
    const problems: string[] = []
    const duration = api.getMeta().duration
    const seen = new Set<string>()
    for (const track of api.getAllTracks()) {
      const node = api.getNode(track.nodeId)
      const label = node ? `"${node.name}" ${track.propertyId}` : `track ${track.id}`
      if (!node) problems.push(`${label}: its layer no longer exists.`)
      if (track.keyframes.length === 0) problems.push(`${label}: track has no keyframes.`)
      const key = `${track.nodeId}:${track.propertyId}`
      if (seen.has(key)) problems.push(`${label}: more than one track for the same property.`)
      seen.add(key)
      let previous = -Infinity
      for (const kf of track.keyframes) {
        if (kf.time < previous) problems.push(`${label}: keyframes are out of order.`)
        previous = kf.time
        if (kf.time > duration + 1e-6) {
          problems.push(`${label}: keyframe at ${kf.time}s is after the scene ends (${duration}s).`)
        }
        if (typeof kf.value === 'number' && !Number.isFinite(kf.value)) {
          problems.push(`${label}: keyframe at ${kf.time}s has a non-finite value.`)
        }
      }
      if (track.propertyId === 'appearance.opacity') {
        for (const kf of track.keyframes) {
          if (typeof kf.value === 'number' && (kf.value < 0 || kf.value > 1)) {
            problems.push(`${label}: opacity ${kf.value} at ${kf.time}s is outside 0-1.`)
          }
        }
      }
    }
    return { ok: problems.length === 0, problems }
  },
}

const previewAnimation: AiTool = {
  name: 'preview',
  mutates: false,
  description:
    'Move the playhead to `time` (seconds) and, if `play` is true, start playback so the user sees the result. Use it after validate_scene to show the finished animation.',
  inputSchema: {
    type: 'object',
    properties: { time: { type: 'number' }, play: { type: 'boolean' } },
  },
  run: ({ setPlayhead, setPlaying }, args) => {
    const time = args.time === undefined ? 0 : Math.max(0, requireNumber(args.time, 'time'))
    setPlaying(false)
    setPlayhead(time)
    if (args.play === true) setPlaying(true)
    return { time, playing: args.play === true }
  },
}

export const AI_TOOLS: AiTool[] = [
  getScene,
  getNode,
  setNodeProperties,
  animateProperty,
  animateNodes,
  clearAnimation,
  createNode,
  deleteNode,
  setSceneMeta,
  selectNodes,
  validateScene,
  previewAnimation,
]

export function listAiToolDefinitions() {
  return AI_TOOLS.map(({ name, description, inputSchema, mutates }) => ({
    name,
    description,
    inputSchema,
    // Everything acts on the open scene only (never the network or disk), and
    // every edit is undoable.
    annotations: {
      readOnlyHint: !mutates,
      destructiveHint: false,
      openWorldHint: false,
    },
  }))
}

/**
 * Run one tool. Mutating tools execute in a single transaction tagged with
 * {@link AI_EDIT_ORIGIN}, so each call is one undo step the panel can revert.
 */
export function runAiTool(
  context: AiToolContext,
  name: string,
  args: Record<string, unknown>,
): { text: string; isError?: boolean } {
  const tool = AI_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) {
    return { text: `Unknown tool "${name}".`, isError: true }
  }
  try {
    let result: unknown
    if (tool.mutates) {
      context.api.doc.transact(() => {
        result = tool.run(context, args)
      }, AI_EDIT_ORIGIN)
    } else {
      result = tool.run(context, args)
    }
    return { text: JSON.stringify(result ?? { ok: true }) }
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    }
  }
}
