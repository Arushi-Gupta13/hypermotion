// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DeviceMockupKind, DeviceMockupSpec } from '@/scene/builtins/deviceMockups'

/** Phone-body thickness, in this app's px-ish scene units. */
const BODY_DEPTH = 16
const BODY_SEGMENTS = 5

/**
 * Stage-one PBR device mockup body: a real extruded, rounded-box mesh with
 * a lit metal/glass material, standing in for the flat vector-drawn Bezel
 * for iPhone-family mockups (see ThreeSceneViewport.tsx's plane-build loop
 * for where this replaces the generic flat-plane path).
 *
 * Origin convention matches `THREE.PlaneGeometry` (what the flat plane
 * this replaces actually uses): centered on the group's own local origin,
 * spanning -width/2..width/2 and -height/2..height/2. The caller positions
 * the whole group in world space via `applyPlaneTransform(group, plane)`
 * — the same function every ordinary flat plane uses — so this mesh needs
 * no bespoke projection math to line up with the mockup's on-canvas
 * transform, rotation, or inherited ancestor offsets.
 */
export function createDeviceMockupBodyMesh(spec: DeviceMockupSpec): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Bezel (PBR)'

  const radius = Math.min(spec.cornerRadius, Math.min(spec.width, spec.height) / 2, BODY_DEPTH / 2)
  const bodyGeometry = new RoundedBoxGeometry(spec.width, spec.height, BODY_DEPTH, BODY_SEGMENTS, radius)
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.bezelColor),
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
    // Every other layer in this compositor stacks by draw order alone
    // (renderOrder), not the GPU depth buffer — see the renderOrder
    // wiring in ThreeSceneViewport.tsx. A depth-tested opaque solid here
    // would occlude/be-occluded by unrelated layers based on raw Z
    // instead of the app's z-index/paint-order, which is the actual bug
    // this fixes: z-index changes near a PBR mockup had no visible
    // effect because this mesh ignored the paint-order system entirely.
    depthTest: false,
    depthWrite: false,
  })
  // RoundedBoxGeometry is already centered on its own origin — no
  // translation needed, it matches PlaneGeometry's convention directly.
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  group.add(body)

  // A thin, glossy dark plate standing in for the glass screen surface —
  // sits just proud of the body's front face so it reads as a distinct
  // material under the studio lights. Real screen *content* still renders
  // through the ordinary Screen frame/plane pipeline on top of this.
  // `spec.screen.x/y` are authored relative to the body's top-left in
  // the original flat convention — recenter into this mesh's centered
  // local space.
  const glassGeometry = new THREE.PlaneGeometry(spec.screen.width, spec.screen.height)
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0.1,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    // See bodyMaterial's comment — matches the rest of the compositor's
    // draw-order-only stacking model.
    depthTest: false,
    depthWrite: false,
  })
  const glass = new THREE.Mesh(glassGeometry, glassMaterial)
  glass.position.set(
    spec.screen.x + spec.screen.width / 2 - spec.width / 2,
    spec.screen.y + spec.screen.height / 2 - spec.height / 2,
    BODY_DEPTH / 2 + 0.5,
  )
  group.add(glass)

  // Every geometry/material here was created fresh for this one instance
  // (unlike the GLB path below, which shares cached, loaded resources
  // across every instance of the same device) — safe for
  // disposeDeviceMockupBodyMesh to destroy outright.
  group.userData.ownsResources = true
  return group
}

/** How the loaded model's local axes are nudged to match this app's plane convention (local +Z is the front, +X right, +Y down) and to line its screen up with the flat Screen-frame plane every mockup already composites on top. */
export interface MockupModelAnchor {
  scale: number
  position: THREE.Vector3
  rotationXDeg?: number
  rotationYDeg?: number
  rotationZDeg?: number
}

// Prefer a mesh actually named for the display over one merely named for
// glass — a phone's rear camera lens is glass too, and matching "glass"
// first would anchor to that instead of the screen. Checked in order.
const SCREEN_MESH_NAME_PATTERN = /screen|display/i
const GLASS_MESH_NAME_PATTERN = /glass/i

function findNamedMesh(root: THREE.Object3D, pattern: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((child) => {
    if (!found && pattern.test(child.name)) found = child
  })
  return found
}

/**
 * Hand-tuned anchors for models whose mesh names give
 * `autoDetectMockupAnchor` nothing to search for (several of these
 * Sketchfab scans use opaque procedural names like `Object_12` or random
 * hashes, not "Screen"/"Glass") — determined by loading the model and
 * visually comparing it against the flat Screen-frame plane every mockup
 * composites on top. Empty until a kind is actually found to need one;
 * add entries here as specific devices are tuned.
 */
const MOCKUP_MODEL_ANCHOR_OVERRIDES: Partial<Record<DeviceMockupKind, MockupModelAnchor>> = {}

/**
 * Best-effort anchor for a loaded device model: find a mesh named for the
 * screen (or, failing that, the glass) and scale/position the whole model
 * so that mesh's real-world width matches `spec.screen.width` and its
 * center lands where the flat Screen-frame plane's center already sits
 * (see `glass.position` above — same formula). Falls back to fitting the
 * model's own overall bounding box when no such mesh exists at all, so a
 * device with opaque mesh names still renders at a plausible size instead
 * of at whatever arbitrary scale it was authored in.
 */
export function autoDetectMockupAnchor(
  model: THREE.Object3D,
  spec: DeviceMockupSpec,
): MockupModelAnchor {
  // `model` was just loaded and has never been part of a rendered scene
  // graph, so descendant `matrixWorld`s may still be stale identity
  // matrices rather than reflecting the file's authored local
  // transforms/scales — force them current before measuring, or the
  // computed box (and the scale/position derived from it) comes out
  // wrong by whatever factor those un-applied transforms represent.
  model.updateMatrixWorld(true)
  const referenceNode =
    findNamedMesh(model, SCREEN_MESH_NAME_PATTERN) ??
    findNamedMesh(model, GLASS_MESH_NAME_PATTERN)
  const box = new THREE.Box3().setFromObject(referenceNode ?? model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const referenceWidth = size.x > 0.0001 ? size.x : 1
  const scale = spec.screen.width / referenceWidth
  const desiredCenterX = spec.screen.x + spec.screen.width / 2 - spec.width / 2
  const desiredCenterY = spec.screen.y + spec.screen.height / 2 - spec.height / 2
  return {
    scale,
    // GLTF/three world is Y-up; this app's flat spec coordinates grow
    // downward (screen convention) — flip Y so the scaled-and-offset
    // model lands right-side-up in our local space.
    position: new THREE.Vector3(
      desiredCenterX - center.x * scale,
      desiredCenterY + center.y * scale,
      -center.z * scale,
    ),
  }
}

/**
 * Real scanned CC-BY device body — the loaded GLTF scene, cloned (so
 * multiple mockup instances of the same device don't fight over one
 * shared transform — see `getCachedMockupModel`'s doc comment) and
 * anchored so its screen sits where the flat Screen-frame plane already
 * expects content, exactly like the procedural body's `glass` plate.
 */
export function createDeviceMockupBodyMeshFromModel(
  model: THREE.Group,
  spec: DeviceMockupSpec,
  kind: DeviceMockupKind,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Bezel (GLB)'
  const instance = model.clone(true)
  const anchor = MOCKUP_MODEL_ANCHOR_OVERRIDES[kind] ?? autoDetectMockupAnchor(model, spec)
  instance.scale.setScalar(anchor.scale)
  instance.position.copy(anchor.position)
  if (anchor.rotationXDeg) instance.rotateX(THREE.MathUtils.degToRad(anchor.rotationXDeg))
  if (anchor.rotationYDeg) instance.rotateY(THREE.MathUtils.degToRad(anchor.rotationYDeg))
  if (anchor.rotationZDeg) instance.rotateZ(THREE.MathUtils.degToRad(anchor.rotationZDeg))
  // Every other layer in this compositor stacks by draw order alone (see
  // bodyMaterial's comment above) — a real GLTF export's materials
  // default to normal depth-testing, which would let this body occlude
  // or be occluded by unrelated layers based on raw GPU depth instead of
  // the app's paint order. Mutating the shared cached material is
  // intentional and cheap: every instance of this device wants the same
  // setting, so there's nothing to keep separate per clone.
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      material.depthTest = false
      material.depthWrite = false
    }
  })
  group.add(instance)
  // This instance's geometries/materials are shared with the cached
  // original model (and every other instance cloned from it) — disposing
  // them here would break every other mockup using the same device.
  group.userData.ownsResources = false
  return group
}

export function disposeDeviceMockupBodyMesh(group: THREE.Group): void {
  if (group.userData.ownsResources === false) return
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material.dispose()
  })
}
