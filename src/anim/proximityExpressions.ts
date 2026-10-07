// SPDX-License-Identifier: Apache-2.0

import type { NodeId, ProximityExpression, ProximityFalloff, ProximityTargetPropertyId } from '@/scene'
import type { AnimatedValue } from './engine'
import type { SceneAPI } from '@/scene/doc'

export interface CompiledProximityExpression {
  targetNodeId: NodeId
  triggerNodeId: NodeId
  radius: number
  falloff: ProximityFalloff
  effects: ReadonlyArray<{
    propertyId: ProximityTargetPropertyId
    from: number
    to: number
  }>
}

export function compileProximityExpressions(
  api: SceneAPI,
): CompiledProximityExpression[] {
  const result: CompiledProximityExpression[] = []
  for (const nodeId of api.getAllNodeIds()) {
    const node = api.getNode(nodeId)
    if (!node?.proximityExpressions?.length) continue
    for (const expr of node.proximityExpressions) {
      if (!expr.enabled) continue
      if (!api.getNode(expr.triggerNodeId)) continue
      if (expr.effects.length === 0) continue
      result.push({
        targetNodeId: nodeId,
        triggerNodeId: expr.triggerNodeId,
        radius: Math.max(0, expr.radius),
        falloff: expr.falloff,
        effects: expr.effects,
      })
    }
  }
  return result
}

function nodeCenter(
  nodeId: NodeId,
  api: SceneAPI,
  snapshot: Record<NodeId, AnimatedValue>,
): { x: number; y: number } {
  const anim = snapshot[nodeId]
  const node = api.getNode(nodeId)
  if (!node) return { x: 0, y: 0 }
  const x = anim?.x ?? node.transform.x
  const y = anim?.y ?? node.transform.y
  return { x, y }
}

function distance2d(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function applyFalloff(t: number, falloff: ProximityFalloff): number {
  const clamped = Math.max(0, Math.min(1, t))
  switch (falloff) {
    case 'linear':
      return clamped
    case 'ease-in':
      return clamped * clamped
    case 'ease-out':
      return 1 - (1 - clamped) * (1 - clamped)
    case 'ease-in-out':
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - 2 * (1 - clamped) * (1 - clamped)
    case 'step':
      return clamped > 0 ? 1 : 0
    default:
      return clamped
  }
}

const PROPERTY_KEY_MAP: Record<ProximityTargetPropertyId, keyof AnimatedValue> = {
  'transform.x': 'x',
  'transform.y': 'y',
  'transform.z': 'z',
  'transform.rotation': 'rotation',
  'transform.scaleX': 'scaleX',
  'transform.scaleY': 'scaleY',
  'appearance.opacity': 'opacity',
  'appearance.cornerRadius': 'cornerRadius',
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function applyProximityExpressions(
  compiled: readonly CompiledProximityExpression[],
  api: SceneAPI,
  snapshot: Record<NodeId, AnimatedValue>,
): void {
  for (const expr of compiled) {
    const triggerPos = nodeCenter(expr.triggerNodeId, api, snapshot)
    const targetPos = nodeCenter(expr.targetNodeId, api, snapshot)
    const dist = distance2d(triggerPos, targetPos)

    if (expr.radius <= 0) continue
    if (dist >= expr.radius) continue

    const proximity = 1 - dist / expr.radius
    const strength = applyFalloff(proximity, expr.falloff)

    const value = snapshot[expr.targetNodeId] ?? {}
    for (const effect of expr.effects) {
      const key = PROPERTY_KEY_MAP[effect.propertyId]
      if (!key) continue
      const current = (value[key] as number | undefined) ?? getNodeDefault(api, expr.targetNodeId, effect.propertyId)
      const delta = lerp(effect.from, effect.to, strength)
      ;(value as Record<string, unknown>)[key] = current + delta
    }
    snapshot[expr.targetNodeId] = value
  }
}

function getNodeDefault(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: ProximityTargetPropertyId,
): number {
  const node = api.getNode(nodeId)
  if (!node) return 0
  switch (propertyId) {
    case 'transform.x': return node.transform.x
    case 'transform.y': return node.transform.y
    case 'transform.z': return node.transform.z
    case 'transform.rotation': return node.transform.rotation
    case 'transform.scaleX': return node.transform.scaleX
    case 'transform.scaleY': return node.transform.scaleY
    case 'appearance.opacity': return node.appearance.opacity ?? 1
    case 'appearance.cornerRadius': return node.appearance.cornerRadius ?? 0
    default: return 0
  }
}

export function proximityStaggerOffset(
  api: SceneAPI,
  triggerNodeId: NodeId,
  targetNodeId: NodeId,
  snapshot: Record<NodeId, AnimatedValue>,
  maxDelay: number,
  radius: number,
): number {
  const triggerPos = nodeCenter(triggerNodeId, api, snapshot)
  const targetPos = nodeCenter(targetNodeId, api, snapshot)
  const dist = distance2d(triggerPos, targetPos)
  if (radius <= 0) return maxDelay
  const t = Math.min(1, dist / radius)
  return t * maxDelay
}
