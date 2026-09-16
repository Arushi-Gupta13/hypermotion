// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEVICE_MOCKUP_SPECS } from '@/scene/builtins/deviceMockups'
import { createDeviceMockupBodyMesh } from './deviceMockupMesh'

describe('createDeviceMockupBodyMesh', () => {
  it('spans the spec width/height with a physical, metallic-glass material', () => {
    const spec = DEVICE_MOCKUP_SPECS.iphone13
    const group = createDeviceMockupBodyMesh(spec)

    const body = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
    expect(body).toBeInstanceOf(THREE.Mesh)
    expect(body.material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(body.material.metalness).toBeGreaterThan(0.5)
    expect(body.material.roughness).toBeLessThan(0.5)

    body.geometry.computeBoundingBox()
    const size = new THREE.Vector3()
    body.geometry.boundingBox!.getSize(size)
    expect(size.x).toBeCloseTo(spec.width, 0)
    expect(size.y).toBeCloseTo(spec.height, 0)

    // Origin convention: centered on the group's local origin, matching
    // THREE.PlaneGeometry — the same convention the flat vector Bezel's
    // plane mesh uses, so `applyPlaneTransform` positions it correctly
    // with no bespoke math.
    expect(body.position.x).toBeCloseTo(0)
    expect(body.position.y).toBeCloseTo(0)
  })

  it('positions the glass plate over the spec screen rect, recentered into local space', () => {
    const spec = DEVICE_MOCKUP_SPECS.iphone13
    const group = createDeviceMockupBodyMesh(spec)
    const glass = group.children[1] as THREE.Mesh

    expect(glass.position.x).toBeCloseTo(
      spec.screen.x + spec.screen.width / 2 - spec.width / 2,
    )
    expect(glass.position.y).toBeCloseTo(
      spec.screen.y + spec.screen.height / 2 - spec.height / 2,
    )
    expect(glass.position.z).toBeGreaterThan(0)
  })

  it('disables depth-testing on every mesh, matching the rest of the compositor', () => {
    // This app stacks every other layer by draw order (renderOrder) alone,
    // never the GPU depth buffer — see the renderOrder wiring in
    // ThreeSceneViewport.tsx. A depth-tested opaque solid here would
    // occlude/be-occluded by unrelated layers based on raw Z instead of
    // the scene's z-index/paint order, which is exactly the bug this
    // guards against: z-index changes near a PBR mockup silently had no
    // visible effect because this mesh ignored draw order entirely.
    const group = createDeviceMockupBodyMesh(DEVICE_MOCKUP_SPECS.iphone13)
    let meshCount = 0
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      meshCount += 1
      const material = child.material as THREE.MeshPhysicalMaterial
      expect(material.depthTest).toBe(false)
      expect(material.depthWrite).toBe(false)
    })
    expect(meshCount).toBe(2)
  })
})
