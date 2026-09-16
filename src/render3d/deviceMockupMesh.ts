// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DeviceMockupSpec } from '@/scene/builtins/deviceMockups'

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

  return group
}

export function disposeDeviceMockupBodyMesh(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material.dispose()
  })
}
