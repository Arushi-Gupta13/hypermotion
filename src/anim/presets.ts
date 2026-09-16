// SPDX-License-Identifier: Apache-2.0

import type { EasingKind, NodeId, PropertyId } from '@/scene'
import type { SceneAPI, StaggerPropertySet } from '@/scene/doc'
import { addKeyframe, clearPresetKeyframes } from './tracks'
import { staggerLayerOffset } from './staggerSets'

/**
 * Jitter-style preset animations.
 *
 * A preset is a tiny recipe that, given a node and a time, generates
 * one-to-three tracks' worth of keyframes. The intent is the same as
 * Jitter: click "Fade In" → your layer fades up over some default
 * duration starting at the current playhead.
 *
 * Design principles:
 *   - Generate keyframes directly onto the scene tracks. No hidden
 *     "preset layer" — once applied, the keyframes are ordinary and
 *     editable just like hand-authored ones.
 *   - Presets distinguish IN (start offscreen/invisible, end normal)
 *     from OUT (start normal, end offscreen/invisible). That's the
 *     canonical Jitter model.
 *   - All presets target transform + opacity. Layout-property
 *     keyframing is reserved for hand-authoring until the FLIP pass
 *     is polished.
 */

export type AnimPresetId =
  | 'fade-in'
  | 'fade-out'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-out-up'
  | 'slide-out-down'
  | 'slide-out-left'
  | 'slide-out-right'
  | 'scale-in'
  | 'scale-out'
  | 'pop'
  // Showcase-style presets covering 3D & Perspective, Orbit, Spotlight &
  // Focus, Stack & Scatter, and Isometric looks. Each still targets plain
  // transform + opacity keyframes — no new node fields or renderer work —
  // so they drop into the same apply/clear/stagger machinery as the
  // presets above.
  | 'tilt-in-3d'
  | 'tilt-out-3d'
  | 'spin-in'
  | 'spin-out'
  | 'focus-in'
  | 'focus-out'
  | 'scatter-in'
  | 'scatter-out'
  | 'isometric-in'
  | 'isometric-out'

export type AnimPresetCategory =
  | 'basic'
  | '3d-perspective'
  | 'orbit'
  | 'spotlight-focus'
  | 'stack-scatter'
  | 'isometric'

export const ANIM_PRESET_CATEGORY_LABELS: Record<AnimPresetCategory, string> = {
  basic: 'Basic',
  '3d-perspective': '3D & Perspective',
  orbit: 'Orbit',
  'spotlight-focus': 'Spotlight & Focus',
  'stack-scatter': 'Stack & Scatter',
  isometric: 'Isometric',
}

export interface AnimPreset {
  id: AnimPresetId
  label: string
  direction: 'in' | 'out'
  category: AnimPresetCategory
  /** Default duration in seconds. */
  duration: number
  easing: EasingKind
}

export interface LayerPresetTargetPlan {
  /** The exact layers that receive preset-authored keyframes. */
  targets: NodeId[]
  /** Whether the targets should be offset and linked as a stagger set. */
  staggerActive: boolean
  delay: number
  order: StaggerPropertySet['order']
}

export interface TextPresetTargetPlan extends LayerPresetTargetPlan {
  /** Full persistent set scope used to calculate each text layer's offset. */
  staggerLayerIds: NodeId[]
}

/**
 * Resolve layer-preset targets without inferring descendants.
 *
 * A selected container is a real animation target, not shorthand for its
 * children. The only time a preset expands beyond the explicit selection is
 * while editing an existing stagger relationship, whose saved members are the
 * explicit scope of that edit mode.
 */
export function planLayerPresetTargets(
  selection: readonly NodeId[],
  staggerOn: boolean,
  staggerDelay: number,
  activeSet?: StaggerPropertySet | null,
): LayerPresetTargetPlan {
  const editingSet = staggerOn && activeSet && activeSet.layerIds.length > 1
    ? activeSet
    : null
  const targets = editingSet
    ? [...editingSet.layerIds]
    : [...selection]
  return {
    targets,
    staggerActive: staggerOn && targets.length > 1,
    delay: editingSet?.delay ?? Math.max(0, staggerDelay),
    order: editingSet?.order ?? 'forward',
  }
}

/**
 * Resolve text-preset targets through the same persistent relationship as
 * layer presets. Existing stagger sets may contain non-text layers, so keep
 * their full ordering for offset math while applying the effect only to text.
 */
export function planTextPresetTargets(
  selection: readonly NodeId[],
  isTextLayer: (id: NodeId) => boolean,
  staggerOn: boolean,
  staggerDelay: number,
  activeSet?: StaggerPropertySet | null,
): TextPresetTargetPlan {
  const layerPlan = planLayerPresetTargets(
    selection,
    staggerOn,
    staggerDelay,
    activeSet,
  )
  const targets = layerPlan.targets.filter(isTextLayer)
  return {
    ...layerPlan,
    targets,
    staggerActive: layerPlan.staggerActive && targets.length > 0,
    staggerLayerIds: layerPlan.targets,
  }
}

/**
 * Align newly adopted text tracks to a persistent S relationship while
 * keeping the anchor track exactly where the user authored it.
 */
export function planTextStaggerStartTimes(
  plan: TextPresetTargetPlan,
  anchorNodeId: NodeId,
  anchorStart: number,
): Partial<Record<NodeId, number>> {
  if (!plan.staggerActive || !plan.staggerLayerIds.includes(anchorNodeId)) {
    return {}
  }
  const baseStart =
    anchorStart -
    staggerLayerOffset(
      plan.staggerLayerIds,
      anchorNodeId,
      plan.delay,
      plan.order,
    )
  return Object.fromEntries(
    plan.targets.map((nodeId) => [
      nodeId,
      baseStart +
        staggerLayerOffset(
          plan.staggerLayerIds,
          nodeId,
          plan.delay,
          plan.order,
        ),
    ]),
  )
}

export const PRESETS: AnimPreset[] = [
  { id: 'fade-in', label: 'Fade In', direction: 'in', category: 'basic', duration: 0.4, easing: 'ease-out' },
  { id: 'fade-out', label: 'Fade Out', direction: 'out', category: 'basic', duration: 0.4, easing: 'ease-in' },
  { id: 'slide-in-up', label: 'Slide Up', direction: 'in', category: 'basic', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-down', label: 'Slide Down', direction: 'in', category: 'basic', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-left', label: 'Slide Left', direction: 'in', category: 'basic', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-right', label: 'Slide Right', direction: 'in', category: 'basic', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-out-up', label: 'Slide Up (out)', direction: 'out', category: 'basic', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-down', label: 'Slide Down (out)', direction: 'out', category: 'basic', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-left', label: 'Slide Left (out)', direction: 'out', category: 'basic', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-right', label: 'Slide Right (out)', direction: 'out', category: 'basic', duration: 0.5, easing: 'ease-in' },
  { id: 'scale-in', label: 'Scale In', direction: 'in', category: 'basic', duration: 0.4, easing: 'ease-out' },
  { id: 'scale-out', label: 'Scale Out', direction: 'out', category: 'basic', duration: 0.4, easing: 'ease-in' },
  { id: 'pop', label: 'Pop', direction: 'in', category: 'basic', duration: 0.5, easing: { bezier: [0.34, 1.56, 0.64, 1] } },
  { id: 'tilt-in-3d', label: 'Tilt In 3D', direction: 'in', category: '3d-perspective', duration: 0.6, easing: 'ease-out' },
  { id: 'tilt-out-3d', label: 'Tilt Out 3D', direction: 'out', category: '3d-perspective', duration: 0.6, easing: 'ease-in' },
  { id: 'spin-in', label: 'Spin In', direction: 'in', category: 'orbit', duration: 0.6, easing: 'ease-out' },
  { id: 'spin-out', label: 'Spin Out', direction: 'out', category: 'orbit', duration: 0.6, easing: 'ease-in' },
  { id: 'focus-in', label: 'Focus In', direction: 'in', category: 'spotlight-focus', duration: 0.5, easing: 'ease-out' },
  { id: 'focus-out', label: 'Focus Out', direction: 'out', category: 'spotlight-focus', duration: 0.5, easing: 'ease-in' },
  { id: 'scatter-in', label: 'Scatter In', direction: 'in', category: 'stack-scatter', duration: 0.55, easing: { bezier: [0.34, 1.2, 0.64, 1] } },
  { id: 'scatter-out', label: 'Scatter Out', direction: 'out', category: 'stack-scatter', duration: 0.55, easing: 'ease-in' },
  { id: 'isometric-in', label: 'Isometric In', direction: 'in', category: 'isometric', duration: 0.6, easing: 'ease-out' },
  { id: 'isometric-out', label: 'Isometric Out', direction: 'out', category: 'isometric', duration: 0.6, easing: 'ease-in' },
]

/** Deterministic small hash so "Scatter" spreads each layer differently but repeatably. */
function hashNodeId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return h
}

/**
 * Apply a preset to a node at a given start time.
 *
 * "Slide In Up" means "enter from below, land in place" — the starting
 * keyframe has `transform.y = +distance`, the ending keyframe has
 * `transform.y = 0`. That matches the direction arrow in Jitter's UI.
 *
 * The slide distance defaults to 80px. Scale presets go from 0.8 → 1.0
 * on both axes. The values will be tweakable in-Inspector later.
 */
export function applyPreset(
  api: SceneAPI,
  nodeId: NodeId,
  preset: AnimPresetId,
  startTime: number,
): void {
  const p = PRESETS.find((x) => x.id === preset)
  if (!p) return
  // Replacement semantics: a fresh IN preset clears any earlier IN
  // stamp (and likewise for OUT), so users can audition preset choices
  // without building up a pile of dead keyframes. Hand-authored
  // keyframes (no `presetOrigin`) survive the prune — see
  // `clearPresetKeyframes`.
  clearPresetKeyframes(api, nodeId, p.direction)

  // Under REPLACE semantics the engine's track values are absolute —
  // so "slide-in-left on a node at x=500" needs keyframes that go from
  // x=580 to x=500, not 80 to 0. Read the node's static pose once and
  // offset every keyframe from it.
  const node = api.getNode(nodeId)
  if (!node) return
  const baseX = node.transform.x
  const baseY = node.transform.y
  const baseZ = node.transform.z
  const baseRotation = node.transform.rotation
  const baseRotX = node.transform.rotationX
  const baseRotY = node.transform.rotationY
  const baseSX = node.transform.scaleX
  const baseSY = node.transform.scaleY
  const baseOp = node.appearance.opacity

  const end = startTime + p.duration
  const SLIDE = 80
  const SCALE_LO = 0.8

  const kf = (
    propertyId: PropertyId,
    t: number,
    value: number,
    easing?: EasingKind,
  ) => addKeyframe(api, nodeId, propertyId, t, value, easing, p.direction)

  switch (preset) {
    case 'fade-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      break
    case 'fade-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      break
    case 'slide-in-up':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.y', startTime, baseY + SLIDE, p.easing)
      kf('transform.y', end, baseY)
      break
    case 'slide-in-down':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.y', startTime, baseY - SLIDE, p.easing)
      kf('transform.y', end, baseY)
      break
    case 'slide-in-left':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.x', startTime, baseX + SLIDE, p.easing)
      kf('transform.x', end, baseX)
      break
    case 'slide-in-right':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.x', startTime, baseX - SLIDE, p.easing)
      kf('transform.x', end, baseX)
      break
    case 'slide-out-up':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.y', startTime, baseY, p.easing)
      kf('transform.y', end, baseY - SLIDE)
      break
    case 'slide-out-down':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.y', startTime, baseY, p.easing)
      kf('transform.y', end, baseY + SLIDE)
      break
    case 'slide-out-left':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.x', startTime, baseX, p.easing)
      kf('transform.x', end, baseX - SLIDE)
      break
    case 'slide-out-right':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.x', startTime, baseX, p.easing)
      kf('transform.x', end, baseX + SLIDE)
      break
    case 'scale-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.scaleX', startTime, baseSX * SCALE_LO, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * SCALE_LO, p.easing)
      kf('transform.scaleY', end, baseSY)
      break
    case 'scale-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.scaleX', startTime, baseSX, p.easing)
      kf('transform.scaleX', end, baseSX * SCALE_LO)
      kf('transform.scaleY', startTime, baseSY, p.easing)
      kf('transform.scaleY', end, baseSY * SCALE_LO)
      break
    case 'pop':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.scaleX', startTime, baseSX * 0.6, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * 0.6, p.easing)
      kf('transform.scaleY', end, baseSY)
      break

    // --- 3D & Perspective ---------------------------------------------
    case 'tilt-in-3d':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.rotationY', startTime, baseRotY - 60, p.easing)
      kf('transform.rotationY', end, baseRotY)
      kf('transform.rotationX', startTime, baseRotX + 15, p.easing)
      kf('transform.rotationX', end, baseRotX)
      kf('transform.z', startTime, baseZ - 140, p.easing)
      kf('transform.z', end, baseZ)
      break
    case 'tilt-out-3d':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.rotationY', startTime, baseRotY, p.easing)
      kf('transform.rotationY', end, baseRotY + 60)
      kf('transform.rotationX', startTime, baseRotX, p.easing)
      kf('transform.rotationX', end, baseRotX - 15)
      kf('transform.z', startTime, baseZ, p.easing)
      kf('transform.z', end, baseZ - 140)
      break

    // --- Orbit -----------------------------------------------------------
    case 'spin-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.rotation', startTime, baseRotation - 170, p.easing)
      kf('transform.rotation', end, baseRotation)
      kf('transform.scaleX', startTime, baseSX * 0.5, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * 0.5, p.easing)
      kf('transform.scaleY', end, baseSY)
      break
    case 'spin-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.rotation', startTime, baseRotation, p.easing)
      kf('transform.rotation', end, baseRotation + 170)
      kf('transform.scaleX', startTime, baseSX, p.easing)
      kf('transform.scaleX', end, baseSX * 0.5)
      kf('transform.scaleY', startTime, baseSY, p.easing)
      kf('transform.scaleY', end, baseSY * 0.5)
      break

    // --- Spotlight & Focus -------------------------------------------
    case 'focus-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.scaleX', startTime, baseSX * 1.5, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * 1.5, p.easing)
      kf('transform.scaleY', end, baseSY)
      kf('transform.z', startTime, baseZ - 60, p.easing)
      kf('transform.z', end, baseZ)
      break
    case 'focus-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.scaleX', startTime, baseSX, p.easing)
      kf('transform.scaleX', end, baseSX * 1.5)
      kf('transform.scaleY', startTime, baseSY, p.easing)
      kf('transform.scaleY', end, baseSY * 1.5)
      kf('transform.z', startTime, baseZ, p.easing)
      kf('transform.z', end, baseZ - 60)
      break

    // --- Stack & Scatter -------------------------------------------------
    // Each layer scatters to a different, but repeatable, nearby offset —
    // reads best applied across a multi-selection with Stagger on.
    case 'scatter-in':
    case 'scatter-out': {
      const hash = hashNodeId(nodeId)
      const offsetX = (hash % 200) - 100
      const offsetY = ((hash >> 8) % 160) - 80
      const offsetRot = ((hash >> 16) % 60) - 30
      const scatteredX = baseX + offsetX
      const scatteredY = baseY + offsetY
      const scatteredRot = baseRotation + offsetRot
      if (preset === 'scatter-in') {
        kf('appearance.opacity', startTime, 0, p.easing)
        kf('appearance.opacity', end, baseOp)
        kf('transform.x', startTime, scatteredX, p.easing)
        kf('transform.x', end, baseX)
        kf('transform.y', startTime, scatteredY, p.easing)
        kf('transform.y', end, baseY)
        kf('transform.rotation', startTime, scatteredRot, p.easing)
        kf('transform.rotation', end, baseRotation)
        kf('transform.scaleX', startTime, baseSX * 0.5, p.easing)
        kf('transform.scaleX', end, baseSX)
        kf('transform.scaleY', startTime, baseSY * 0.5, p.easing)
        kf('transform.scaleY', end, baseSY)
      } else {
        kf('appearance.opacity', startTime, baseOp, p.easing)
        kf('appearance.opacity', end, 0)
        kf('transform.x', startTime, baseX, p.easing)
        kf('transform.x', end, scatteredX)
        kf('transform.y', startTime, baseY, p.easing)
        kf('transform.y', end, scatteredY)
        kf('transform.rotation', startTime, baseRotation, p.easing)
        kf('transform.rotation', end, scatteredRot)
        kf('transform.scaleX', startTime, baseSX, p.easing)
        kf('transform.scaleX', end, baseSX * 0.5)
        kf('transform.scaleY', startTime, baseSY, p.easing)
        kf('transform.scaleY', end, baseSY * 0.5)
      }
      break
    }

    // --- Isometric ---------------------------------------------------
    // Unlike the presets above, the "landed" pose is a deliberate tilt,
    // not the node's original rotation — this is a showcase "look" the
    // layer settles into, not a return to its authored pose.
    case 'isometric-in': {
      const ISO_X = 35
      const ISO_Y = 45
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.rotationX', startTime, 0, p.easing)
      kf('transform.rotationX', end, ISO_X)
      kf('transform.rotationY', startTime, 0, p.easing)
      kf('transform.rotationY', end, ISO_Y)
      kf('transform.scaleX', startTime, baseSX * 0.7, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * 0.7, p.easing)
      kf('transform.scaleY', end, baseSY)
      break
    }
    case 'isometric-out': {
      const ISO_X = 35
      const ISO_Y = 45
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.rotationX', startTime, ISO_X, p.easing)
      kf('transform.rotationX', end, 0)
      kf('transform.rotationY', startTime, ISO_Y, p.easing)
      kf('transform.rotationY', end, 0)
      kf('transform.scaleX', startTime, baseSX, p.easing)
      kf('transform.scaleX', end, baseSX * 0.7)
      kf('transform.scaleY', startTime, baseSY, p.easing)
      kf('transform.scaleY', end, baseSY * 0.7)
      break
    }
  }
}
