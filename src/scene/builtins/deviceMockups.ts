// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId, VectorDocument, VectorItem, VectorPaint } from '@/scene/types'
import { createVectorItem, solidVectorPaint } from '@/scene/vector/model'
import { VectorPathBuilder } from '@/scene/vector/path'
import { uniqueNodeName } from '@/scene/uniqueNodeName'

/**
 * Device mockup presets — a static bezel (vector-drawn, not an image asset)
 * wrapping an inner "Screen" frame. The screen is an ordinary `clipsContent`
 * frame, so it inherits the app's existing 3D clip-prism: children dropped
 * inside can carry their own transform.z/rotationX/rotationY and animate
 * independently, and still get masked correctly at the screen edges at any
 * depth (see scene3d.ts's `clipFromFrame` — no near/far cap, only the four
 * side planes). No render-pipeline work needed for that part; this module
 * is purely the authoring/insertion side.
 */

export type DeviceMockupKind =
  | 'iphone17promax'
  | 'iphone17pro'
  | 'iphone16promax'
  | 'iphone13'
  | 'iphonese'
  | 'galaxys24ultra'
  | 'galaxys24'
  | 'macbookpro14'
  | 'macbookpro16'
  | 'ipadpro13'
  | 'applewatchseries9'
  | 'applewatchultra2'
  | 'imac24'
  | 'prodisplayxdr'
  | 'browser'

/** How the top of the screen reads — the clearest visual split between eras/brands. */
type TopChrome = 'island' | 'notch' | 'punchhole' | 'none'

export interface DeviceMockupSpec {
  label: string
  family: 'iphone' | 'samsung' | 'macbook' | 'ipad' | 'watch' | 'imac' | 'display' | 'browser'
  width: number
  height: number
  cornerRadius: number
  bezelColor: string
  /** Screen inset from the bezel edge on each side. */
  screen: { x: number; y: number; width: number; height: number }
  screenCornerRadius: number
  topChrome: TopChrome
  /** iPhone SE-style flat bezel: a physical home button below the screen. */
  homeButton: boolean
  /**
   * URL (served from `public/`) of a real scanned CC-BY 3D model to use for
   * the final 3D render body, replacing the procedural bezel mesh built
   * from the fields above — see `createDeviceMockupBodyMesh` /
   * `deviceMockupGltfCache.ts`. The fields above still define the flat
   * vector fallback (used for the 2D editor hit-box, and while/if the real
   * model hasn't loaded), so they stay populated even when this is set.
   * See NOTICE for each model's credit and license (CC-BY, attribution
   * required).
   */
  glbUrl?: string
}

// Dimensions are stylized approximations (logical points), not pixel-exact
// spec sheets — this is a procedurally-drawn mockup, not a photorealistic
// asset. Exact figures for very recent hardware aren't something I can
// verify; swap DEVICE_MOCKUP_SPECS[kind] values here if you have precise
// numbers for a specific model.
export const DEVICE_MOCKUP_SPECS: Record<DeviceMockupKind, DeviceMockupSpec> = {
  iphone17promax: {
    label: 'iPhone 17 Pro Max',
    family: 'iphone',
    width: 440,
    height: 956,
    cornerRadius: 62,
    bezelColor: '#0a0a0a',
    screen: { x: 9, y: 9, width: 422, height: 938 },
    screenCornerRadius: 54,
    topChrome: 'island',
    homeButton: false,
    glbUrl: '/models/mockups/iphone-17-pro-max.glb',
  },
  iphone17pro: {
    label: 'iPhone 17 Pro',
    family: 'iphone',
    width: 402,
    height: 874,
    cornerRadius: 56,
    bezelColor: '#0a0a0a',
    screen: { x: 9, y: 9, width: 384, height: 856 },
    screenCornerRadius: 48,
    topChrome: 'island',
    homeButton: false,
    glbUrl: '/models/mockups/iphone-17-pro.glb',
  },
  iphone16promax: {
    label: 'iPhone 16 Pro Max',
    family: 'iphone',
    width: 430,
    height: 932,
    cornerRadius: 58,
    bezelColor: '#0a0a0a',
    screen: { x: 9, y: 9, width: 412, height: 914 },
    screenCornerRadius: 50,
    topChrome: 'island',
    homeButton: false,
    glbUrl: '/models/mockups/iphone-16-pro-max.glb',
  },
  iphone13: {
    label: 'iPhone 13',
    family: 'iphone',
    width: 390,
    height: 844,
    cornerRadius: 48,
    bezelColor: '#141414',
    screen: { x: 8, y: 8, width: 374, height: 828 },
    screenCornerRadius: 40,
    topChrome: 'notch',
    homeButton: false,
  },
  iphonese: {
    label: 'iPhone SE',
    family: 'iphone',
    // 375×667 is Apple's actual UIKit point resolution for the SE
    // 2nd/3rd gen (and, before it, the iPhone 6/7/8) — the one figure
    // here that's a real, well-established spec rather than a stylized
    // guess. Bezel margins around it are still stylized.
    width: 399,
    height: 767,
    cornerRadius: 30,
    bezelColor: '#1c1c1c',
    // Flat top bezel (no island/notch) and a taller bottom bezel for the
    // physical home button — the visual tell of the pre-notch iPhone body.
    screen: { x: 12, y: 40, width: 375, height: 667 },
    screenCornerRadius: 0,
    topChrome: 'none',
    homeButton: true,
  },
  galaxys24ultra: {
    label: 'Galaxy S24 Ultra',
    family: 'samsung',
    width: 420,
    height: 918,
    // Samsung's flagship line reads flatter/squarer than an iPhone's body —
    // the corner radius is the main shape cue that tells them apart at a
    // glance in a stylized mockup like this.
    cornerRadius: 34,
    bezelColor: '#111214',
    screen: { x: 7, y: 7, width: 406, height: 904 },
    screenCornerRadius: 28,
    topChrome: 'punchhole',
    homeButton: false,
  },
  galaxys24: {
    label: 'Galaxy S24',
    family: 'samsung',
    width: 371,
    height: 807,
    cornerRadius: 30,
    bezelColor: '#1a1b1e',
    screen: { x: 7, y: 7, width: 357, height: 793 },
    screenCornerRadius: 24,
    topChrome: 'punchhole',
    homeButton: false,
  },
  macbookpro14: {
    label: 'MacBook Pro 14"',
    family: 'macbook',
    // Logical point resolution of the 14" MacBook Pro's own screen — the
    // flat vector fallback only needs to cover the display, not the
    // keyboard deck; the real model (once loaded) supplies the full body.
    width: 1512,
    height: 982,
    cornerRadius: 20,
    bezelColor: '#1d1d1f',
    screen: { x: 14, y: 14, width: 1484, height: 954 },
    screenCornerRadius: 14,
    // Modern MacBook Pros have a small camera notch cut into the display
    // itself — the same visual device 'notch' already models for phones.
    topChrome: 'notch',
    homeButton: false,
    glbUrl: '/models/mockups/macbook-pro-14.glb',
  },
  macbookpro16: {
    label: 'MacBook Pro 16"',
    family: 'macbook',
    width: 1728,
    height: 1117,
    cornerRadius: 20,
    bezelColor: '#1d1d1f',
    screen: { x: 16, y: 16, width: 1696, height: 1085 },
    screenCornerRadius: 14,
    topChrome: 'notch',
    homeButton: false,
    glbUrl: '/models/mockups/macbook-pro-16.glb',
  },
  ipadpro13: {
    label: 'iPad Pro 13"',
    family: 'ipad',
    width: 1032,
    height: 1376,
    cornerRadius: 44,
    bezelColor: '#1c1c1e',
    screen: { x: 14, y: 14, width: 1004, height: 1348 },
    screenCornerRadius: 34,
    // iPad Pro's front camera is a plain circular punch-hole in the top
    // bezel, not a notch or island.
    topChrome: 'punchhole',
    homeButton: false,
    glbUrl: '/models/mockups/ipad-pro-13.glb',
  },
  applewatchseries9: {
    label: 'Apple Watch Series 9',
    family: 'watch',
    width: 220,
    height: 264,
    // A watch face reads as a squircle, not a phone-style rounded rect —
    // the corner radius here is deliberately large relative to width/height.
    cornerRadius: 60,
    bezelColor: '#1a1a1c',
    screen: { x: 10, y: 10, width: 200, height: 244 },
    screenCornerRadius: 50,
    topChrome: 'none',
    homeButton: false,
    glbUrl: '/models/mockups/watch-series-9.glb',
  },
  applewatchultra2: {
    label: 'Apple Watch Ultra 2',
    family: 'watch',
    width: 236,
    height: 284,
    cornerRadius: 56,
    // Titanium case reads lighter/warmer than the standard Series 9's
    // aluminum/steel body.
    bezelColor: '#3a3a3c',
    screen: { x: 12, y: 12, width: 212, height: 260 },
    screenCornerRadius: 46,
    topChrome: 'none',
    homeButton: false,
    glbUrl: '/models/mockups/watch-ultra-2.glb',
  },
  imac24: {
    label: 'iMac 24"',
    family: 'imac',
    width: 1120,
    height: 656,
    cornerRadius: 20,
    bezelColor: '#f0f0f0',
    screen: { x: 20, y: 20, width: 1080, height: 596 },
    screenCornerRadius: 10,
    topChrome: 'punchhole',
    homeButton: false,
    glbUrl: '/models/mockups/imac-24.glb',
  },
  prodisplayxdr: {
    label: 'Pro Display XDR',
    family: 'display',
    width: 1504,
    height: 846,
    cornerRadius: 16,
    bezelColor: '#e4e4e4',
    screen: { x: 8, y: 8, width: 1488, height: 830 },
    screenCornerRadius: 8,
    // A standalone display has no built-in camera.
    topChrome: 'none',
    homeButton: false,
    glbUrl: '/models/mockups/pro-display-xdr.glb',
  },
  browser: {
    label: 'Browser',
    family: 'browser',
    width: 1280,
    height: 800,
    cornerRadius: 10,
    bezelColor: '#e2e2e5',
    screen: { x: 0, y: 44, width: 1280, height: 756 },
    screenCornerRadius: 0,
    topChrome: 'none',
    homeButton: false,
  },
}

/** Grouped for the picker — brand, then other chrome. */
export const DEVICE_MOCKUP_GROUPS: { label: string; kinds: DeviceMockupKind[] }[] = [
  { label: 'iPhone', kinds: ['iphone17promax', 'iphone17pro', 'iphone16promax', 'iphone13', 'iphonese'] },
  { label: 'Samsung Galaxy', kinds: ['galaxys24ultra', 'galaxys24'] },
  { label: 'MacBook', kinds: ['macbookpro16', 'macbookpro14'] },
  { label: 'iPad', kinds: ['ipadpro13'] },
  { label: 'Apple Watch', kinds: ['applewatchultra2', 'applewatchseries9'] },
  { label: 'Display', kinds: ['imac24', 'prodisplayxdr'] },
  { label: 'Browser', kinds: ['browser'] },
]

const BEZEL_KAPPA = 0.5522847498307936

function roundedRectGeometry(
  idPrefix: string,
  width: number,
  height: number,
  radius: number,
): VectorDocument['items'][number]['geometry'] {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
  const builder = new VectorPathBuilder(idPrefix)
  if (r === 0) {
    return builder
      .moveTo(0, 0)
      .lineTo(width, 0)
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .build()
  }
  const k = r * BEZEL_KAPPA
  return builder
    .moveTo(r, 0)
    .lineTo(width - r, 0)
    .cubicTo(width - r + k, 0, width, r - k, width, r)
    .lineTo(width, height - r)
    .cubicTo(width, height - r + k, width - r + k, height, width - r, height)
    .lineTo(r, height)
    .cubicTo(r - k, height, 0, height - r + k, 0, height - r)
    .lineTo(0, r)
    .cubicTo(0, r - k, r - k, 0, r, 0)
    .closePath()
    .build()
}

/** Filled rounded-rect pill — the island/notch/home-button/toolbar-dot shape. */
function pillGeometry(
  idPrefix: string,
  width: number,
  height: number,
): VectorDocument['items'][number]['geometry'] {
  return roundedRectGeometry(idPrefix, width, height, height / 2)
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/** Blend a hex color toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const target = amount > 0 ? 255 : 0
  const t = Math.min(1, Math.abs(amount))
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t)
}

/**
 * A diagonal metal/glass-style sheen instead of one flat fill — the single
 * biggest lever for reading as "device" instead of "rounded rectangle" in
 * a procedurally-drawn (no image asset) mockup. Browser chrome stays flat;
 * a toolbar reads as UI, not a physical shell.
 */
function bezelBodyFill(spec: DeviceMockupSpec): VectorPaint {
  if (spec.family === 'browser') {
    return solidVectorPaint(spec.bezelColor, 'body-fill')
  }
  return {
    id: 'body-fill',
    kind: 'linear',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    coordinateSpace: 'objectBoundingBox',
    start: { x: 0.1, y: 0 },
    end: { x: 0.9, y: 1 },
    stops: [
      { at: 0, color: shade(spec.bezelColor, 0.24) },
      { at: 0.1, color: shade(spec.bezelColor, 0.07) },
      { at: 0.55, color: spec.bezelColor },
      { at: 1, color: shade(spec.bezelColor, -0.2) },
    ],
  }
}

function bezelVectorDocument(spec: DeviceMockupSpec): VectorDocument {
  const items: VectorItem[] = [
    createVectorItem({
      id: 'body',
      geometry: roundedRectGeometry('body', spec.width, spec.height, spec.cornerRadius),
      fills: [bezelBodyFill(spec)],
      strokes:
        spec.family === 'browser'
          ? []
          : [
              {
                id: 'body-edge-highlight',
                paint: {
                  id: 'body-edge-highlight-paint',
                  kind: 'solid',
                  color: shade(spec.bezelColor, 0.4),
                  visible: true,
                  opacity: 0.4,
                  blendMode: 'normal',
                },
                width: 1,
                align: 'inside',
                cap: 'butt',
                join: 'round',
                miterLimit: 4,
                dash: [],
                dashOffset: 0,
                opacity: 1,
                visible: true,
              },
            ],
    }),
  ]
  if (spec.family === 'browser') {
    // Three window-control dots in the toolbar strip above the screen.
    const dotColors = ['#ff5f57', '#febc2e', '#28c840']
    dotColors.forEach((color, i) => {
      const cx = 20 + i * 20
      const cy = 22
      const dotRadius = 6
      items.push(
        createVectorItem({
          id: `dot-${i}`,
          transform: [1, 0, 0, 1, cx - dotRadius, cy - dotRadius],
          geometry: pillGeometry(`dot-${i}`, dotRadius * 2, dotRadius * 2),
          fills: [solidVectorPaint(color, `dot-${i}-fill`)],
        }),
      )
    })
  }
  if (spec.homeButton) {
    const buttonRadius = 18
    const cx = spec.width / 2
    const cy = spec.screen.y + spec.screen.height + (spec.height - spec.screen.y - spec.screen.height) / 2
    items.push(
      createVectorItem({
        id: 'home-button',
        transform: [1, 0, 0, 1, cx - buttonRadius, cy - buttonRadius],
        geometry: pillGeometry('home-button', buttonRadius * 2, buttonRadius * 2),
        fills: [],
        strokes: [
          {
            id: 'home-button-stroke',
            paint: {
              id: 'home-button-stroke-paint',
              kind: 'solid',
              color: '#3a3a3a',
              visible: true,
              opacity: 1,
              blendMode: 'normal',
            },
            width: 2,
            align: 'center',
            cap: 'butt',
            join: 'miter',
            miterLimit: 4,
            dash: [],
            dashOffset: 0,
            opacity: 1,
            visible: true,
          },
        ],
      }),
    )
  }
  return { version: 1, items }
}

/**
 * Drawn as its own vector item, placed after the Screen frame in the
 * outer group's child order, so it paints above screen content — the
 * island/notch has to occlude whatever's underneath, same as on a real
 * phone.
 */
function topChromeVectorDocument(spec: DeviceMockupSpec): VectorDocument | null {
  if (spec.topChrome === 'island') {
    // Dynamic Island: a pill that floats clear of the top edge, detached
    // from the bezel — the visual signature that separates it from the
    // older notch, which is flush against the top.
    const width = spec.screen.width * 0.32
    const height = spec.screen.width * 0.088
    const x = (spec.width - width) / 2
    const y = spec.screen.y + spec.screen.width * 0.028
    return {
      version: 1,
      items: [
        createVectorItem({
          id: 'island',
          transform: [1, 0, 0, 1, x, y],
          geometry: pillGeometry('island', width, height),
          fills: [solidVectorPaint('#000000', 'island-fill')],
        }),
      ],
    }
  }
  if (spec.topChrome === 'notch') {
    // Classic notch: flush against the top edge, wider and flatter.
    const width = spec.screen.width * 0.44
    const height = spec.screen.width * 0.084
    const x = (spec.width - width) / 2
    return {
      version: 1,
      items: [
        createVectorItem({
          id: 'notch',
          transform: [1, 0, 0, 1, x, spec.screen.y],
          geometry: roundedRectGeometry('notch', width, height, height / 2),
          fills: [solidVectorPaint('#000000', 'notch-fill')],
        }),
      ],
    }
  }
  if (spec.topChrome === 'punchhole') {
    // Samsung's flagship line centers a single circular camera cutout,
    // clear of the top edge — no notch or island shelf at all.
    const diameter = spec.screen.width * 0.065
    const x = spec.width / 2 - diameter / 2
    const y = spec.screen.y + spec.screen.width * 0.032
    return {
      version: 1,
      items: [
        createVectorItem({
          id: 'punch-hole',
          transform: [1, 0, 0, 1, x, y],
          geometry: pillGeometry('punch-hole', diameter, diameter),
          fills: [solidVectorPaint('#000000', 'punch-hole-fill')],
        }),
      ],
    }
  }
  return null
}


const EMPTY_APPEARANCE = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  blendMode: 'normal' as const,
  effects: [],
}

const IDENTITY_TRANSFORM = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
}

/**
 * True for every mockup kind that gets a real 3D body mesh in the final
 * render — the original iPhone-family procedural PBR treatment, plus any
 * kind with a real scanned `glbUrl` model — instead of the plain flat
 * vector bezel. Single source of truth shared with
 * `ThreeSceneViewport.tsx`'s substitution gate, so the two can't drift.
 */
export function mockupHasRealBody(spec: DeviceMockupSpec): boolean {
  return spec.family === 'iphone' || !!spec.glbUrl
}

/**
 * Insert one device mockup at `at`. Each insertion is an independent,
 * ordinary frame group — not a shared component/instance — so users can
 * freely restyle or resize one without affecting any other mockup already
 * in the scene.
 */
export function insertDeviceMockup(
  api: SceneAPI,
  parentId: NodeId | null,
  kind: DeviceMockupKind,
  at: { x: number; y: number },
): NodeId {
  const spec = DEVICE_MOCKUP_SPECS[kind]
  let outerId = ''
  api.doc.transact(() => {
    const name = uniqueNodeName(api, `${spec.label} Mockup`)
    outerId = api.createNode('frame', parentId, {
      name,
      // Without this the frame defaults to 'flow' layout participation —
      // inside any auto-layout parent, Yoga would then own its size and
      // resize handles would have nothing to write to.
      position: 'absolute',
      size: { width: spec.width, height: spec.height },
      clipsContent: false,
      // Lets the 3D renderer look up this mockup's exact spec (for the
      // PBR device body mesh) without guessing from its name or size.
      deviceMockupKind: kind,
      appearance: {
        ...EMPTY_APPEARANCE,
        // Soft ambient shadow so the mockup reads as sitting in front of
        // whatever's behind it, instead of pasted flat onto the canvas —
        // EXCEPT for a mockup that gets a real 3D body (iPhone-family
        // procedural PBR, or any kind with `glbUrl`): a visible layer
        // effect on a frame with children forces the whole subtree to
        // rasterize as one flat texture (`nodeEffectsWrapSubtree` in
        // layerEffects.ts), which would silently override the `group3d`
        // below and make the Bezel plane this body mesh needs never
        // exist. Those mockups get their depth from the body's own real
        // geometry instead of a faked shadow.
        effects: mockupHasRealBody(spec)
          ? []
          : [
              {
                kind: 'shadow',
                color: 'oklch(0.15 0.01 280 / 0.35)',
                offsetX: 0,
                offsetY: spec.height * 0.03,
                blur: spec.width * 0.12,
                spread: -(spec.width * 0.03),
                visible: true,
              },
            ],
      },
      // 'group3d' is what makes each child (Bezel, Screen, any top
      // chrome) promote to its OWN plane instead of getting flattened
      // into one shared rasterized texture (see `shouldEmitPlane` in
      // scene3d.ts, which only promotes a non-root-child node when its
      // OWN renderMode is 'plane'/'group3d' or its PARENT's is
      // 'group3d') — without this, the Bezel is never its own plane, so
      // ThreeSceneViewport's PBR/GLB body-mesh substitution (which looks
      // specifically for a "Bezel" plane) never has anything to match.
      transform: { ...IDENTITY_TRANSFORM, x: at.x, y: at.y, renderMode: 'group3d' },
    })

    // Child index 0 is frontmost in this app's layer/paint order (see
    // layerCompositing.ts's `nodesInBackToFrontPaintOrder`), so creation
    // order here goes front-to-back: the notch/island paints over the
    // screen, and the screen paints over the bezel body underneath it.
    // Creating the opaque Bezel first put it at index 0 — frontmost —
    // which hid the screen, the notch, and any content dropped in behind
    // one solid near-black rectangle.
    const topChrome = topChromeVectorDocument(spec)
    if (topChrome) {
      api.createNode('vector', outerId, {
        name:
          spec.topChrome === 'island'
            ? 'Dynamic Island'
            : spec.topChrome === 'punchhole'
              ? 'Punch Hole'
              : 'Notch',
        position: 'absolute',
        size: { width: spec.width, height: spec.height },
        transform: { ...IDENTITY_TRANSFORM },
        viewBox: { x: 0, y: 0, width: spec.width, height: spec.height },
        vector: topChrome,
        importFidelity: 'editable' as const,
      })
    }

    api.createNode('frame', outerId, {
      name: 'Screen',
      position: 'absolute',
      size: { width: spec.screen.width, height: spec.screen.height },
      clipsContent: true,
      appearance: {
        ...EMPTY_APPEARANCE,
        // Deliberately lighter than the bezel (#0a0a0a-ish) — an empty
        // screen in near-identical near-black made the whole mockup read
        // as one flat block with no visible seam between bezel and screen.
        fill: { kind: 'solid' as const, color: '#2c2c2e' },
        cornerRadius: spec.screenCornerRadius,
      },
      transform: { ...IDENTITY_TRANSFORM, x: spec.screen.x, y: spec.screen.y },
    })

    api.createNode('vector', outerId, {
      name: 'Bezel',
      position: 'absolute',
      size: { width: spec.width, height: spec.height },
      transform: { ...IDENTITY_TRANSFORM },
      viewBox: { x: 0, y: 0, width: spec.width, height: spec.height },
      vector: bezelVectorDocument(spec),
      importFidelity: 'editable' as const,
    })
  })
  return outerId
}

/**
 * Structural check, not a schema tag — a frame counts as a device-mockup
 * root if it has the exact child shape `insertDeviceMockup` builds (a
 * `Bezel` vector and a `Screen` frame among its direct children). No new
 * data-model field needed, and it still recognizes a mockup after the user
 * renames the group itself.
 */
export function isDeviceMockupRoot(api: SceneAPI, nodeId: NodeId): boolean {
  const children = api.getChildren(nodeId)
  return (
    children.some((c) => c.name === 'Bezel' && c.kind === 'vector') &&
    children.some((c) => c.name === 'Screen' && c.kind === 'frame')
  )
}

/**
 * The corner-drag resize handles write a new `size` to the outer frame,
 * but its Bezel/Screen/chrome children are `position: 'absolute'` with
 * their own fixed pixel geometry — nothing about a parent size change
 * naturally propagates to them (this layout engine has no percentage or
 * edge-constraint system for absolute children). Without this, dragging a
 * mockup's corner changed its bounding box but visually nothing moved.
 *
 * Rescales every direct child's transform.x/y and (for numeric-sized
 * children) size.width/height by the same ratio the frame itself just
 * resized by. A vector child's `viewBox` is deliberately left untouched —
 * once its box and viewBox stop matching 1:1, the existing viewBox→box
 * scale in the renderer stretches its geometry (rounded corners, notch,
 * island) proportionally for free.
 */
export function rescaleDeviceMockupChildren(
  api: SceneAPI,
  nodeId: NodeId,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): void {
  if (oldWidth <= 0 || oldHeight <= 0) return
  const scaleX = newWidth / oldWidth
  const scaleY = newHeight / oldHeight
  if (Math.abs(scaleX - 1) < 1e-6 && Math.abs(scaleY - 1) < 1e-6) return
  for (const child of api.getChildren(nodeId)) {
    api.setNodeProperty(child.id, 'transform', {
      ...child.transform,
      x: child.transform.x * scaleX,
      y: child.transform.y * scaleY,
    })
    if ('size' in child) {
      const { width, height } = child.size
      api.setNodeProperty(child.id, 'size', {
        width: typeof width === 'number' ? width * scaleX : width,
        height: typeof height === 'number' ? height * scaleY : height,
      })
    }
  }
}

/**
 * Bezel/screen colors read live off the mockup's own children, for the
 * resize-drag ghost preview (`SelectionOverlay`) — layout re-solve is
 * frozen during a drag (see `useLayout.ts`), so the real WebGL mesh
 * doesn't follow the pointer; this CSS approximation stands in for it
 * until release, when the authoritative geometry catches up. Not exact
 * (a flat rounded-rect stand-in, no notch/island shape), just enough to
 * read as "this is resizing" instead of freezing until you let go.
 */
export function mockupGhostColors(
  api: SceneAPI,
  nodeId: NodeId,
): { bezelColor: string; screenColor: string } | null {
  const children = api.getChildren(nodeId)
  const bezel = children.find((c) => c.name === 'Bezel' && c.kind === 'vector')
  const screen = children.find((c) => c.name === 'Screen' && c.kind === 'frame')
  if (!bezel || !screen || bezel.kind !== 'vector' || screen.kind !== 'frame') {
    return null
  }
  const bezelFill = bezel.vector.items[0]?.fills[0]
  const screenFill = screen.appearance.fill
  return {
    bezelColor: bezelFill?.kind === 'solid' ? bezelFill.color : '#0a0a0a',
    screenColor: screenFill?.kind === 'solid' ? screenFill.color : '#2c2c2e',
  }
}
