// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export const MOCKUP_MODEL_LOADED_EVENT = 'hypermotion:render3d-mockup-model-loaded'

interface CacheEntry {
  status: 'loading' | 'ready' | 'error'
  scene?: THREE.Group
}

const cache = new Map<string, CacheEntry>()
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

let ktx2Ready = false

/**
 * These CC-BY device scans (see NOTICE) ship compressed per their web-
 * optimized export: `EXT_meshopt_compression` for geometry and
 * `KHR_texture_basisu` (Basis Universal / KTX2) for textures — both
 * *required* extensions per the files' own `extensionsRequired`, not
 * optional ones GLTFLoader can skip. Without registering a decoder for
 * each, loading throws ("setMeshoptDecoder must be called before
 * loading compressed files") instead of silently degrading, so a
 * mockup with a `glbUrl` would sit on its procedural-body placeholder
 * forever.
 *
 * KTX2Loader specifically needs a live WebGLRenderer to detect which
 * compressed-texture formats the GPU actually supports
 * (`detectSupport`), so this can't run at module load time — call it
 * once a renderer exists (ThreeSceneViewport does, right after creating
 * its own). Safe to call more than once (e.g. from multiple viewport
 * instances); only the first call does anything.
 */
export function initMockupModelLoader(renderer: THREE.WebGLRenderer): void {
  if (ktx2Ready) return
  ktx2Ready = true
  const ktx2Loader = new KTX2Loader()
  ktx2Loader.setTranscoderPath('/basis/')
  ktx2Loader.detectSupport(renderer)
  loader.setKTX2Loader(ktx2Loader)
}

function dispatchLoadedEvent(): void {
  window.dispatchEvent(new Event(MOCKUP_MODEL_LOADED_EVENT))
}

/**
 * Kick off (if not already in flight) loading the CC-BY device model at
 * `url`, and return whatever's cached right now — `undefined` while it's
 * still loading or hasn't been requested yet. Callers render a placeholder
 * (the procedural body) until this returns a real scene, and listen for
 * `MOCKUP_MODEL_LOADED_EVENT` to know when to ask again — the same
 * fire-and-poll pattern `getCachedTextureImage` uses for images.
 *
 * The returned Group is the cached, ORIGINAL loaded scene — callers must
 * `.clone(true)` it before adding to their own THREE.Group, since Three
 * only supports one parent at a time and a scene can have several mockup
 * instances on canvas simultaneously (geometries/materials are still
 * shared across clones; only the transform hierarchy is duplicated).
 */
export function getCachedMockupModel(url: string): THREE.Group | undefined {
  const entry = cache.get(url)
  if (entry?.status === 'ready') return entry.scene
  if (entry) return undefined // loading or errored — caller keeps using the placeholder

  cache.set(url, { status: 'loading' })
  loader.load(
    url,
    (gltf) => {
      cache.set(url, { status: 'ready', scene: gltf.scene })
      dispatchLoadedEvent()
    },
    undefined,
    (error) => {
      console.error(`Failed to load device mockup model: ${url}`, error)
      cache.set(url, { status: 'error' })
      dispatchLoadedEvent()
    },
  )
  return undefined
}
