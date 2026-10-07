import fs from 'node:fs'
import path from 'node:path'
import { buildSceneBytes, readSceneSummary, validateScene, type SceneJson, type NodeJson, type TrackJson } from './build.js'

const nodes: Record<string, NodeJson> = {}
const tracks: Record<string, TrackJson> = {}
const W = 1440, H = 900

// ── Helpers ──
function addToRoot(node: NodeJson) {
  node.parent = 'root'
  nodes[node.id] = node
  nodes['root'].children!.push(node.id)
}
function addChild(node: NodeJson, parentId: string) {
  node.parent = parentId
  nodes[node.id] = node
  if (!nodes[parentId].children) nodes[parentId].children = []
  nodes[parentId].children!.push(node.id)
}

let _tid = 0
function fadeIn(nodeId: string, start: number, dur = 0.6) {
  const t = `op-${_tid++}`
  tracks[t] = {
    id: t, nodeId, propertyId: 'appearance.opacity',
    keyframes: [
      { id: `${t}-0`, time: 0, value: 0 },
      { id: `${t}-1`, time: start, value: 0 },
      { id: `${t}-2`, time: start + dur, value: 1 },
    ],
  }
}
function slideUp(nodeId: string, start: number, fromY: number, toY: number, dur = 0.8) {
  const t = `y-${_tid++}`
  tracks[t] = {
    id: t, nodeId, propertyId: 'transform.y', defaultEasing: 'ease-out',
    keyframes: [
      { id: `${t}-0`, time: start, value: fromY },
      { id: `${t}-1`, time: start + dur, value: toY },
    ],
  }
}

// ══════════════════════════════════════════════
// ROOT — dark background
// ══════════════════════════════════════════════
nodes['root'] = {
  id: 'root', kind: 'frame', parent: null, name: 'Scene',
  children: [],
  size: { width: W, height: H },
  appearance: {
    fill: { kind: 'radial', stops: [
      { at: 0, color: '#0d0d12' },
      { at: 1, color: '#000000' },
    ], cx: 0.5, cy: 0.4, shape: 'ellipse' },
  },
} as NodeJson

// ══════════════════════════════════════════════
// ACT 1: LOGO + BRAND (0–2.5s)
// ══════════════════════════════════════════════

// Logo mark — orange square with "N"
addToRoot({
  id: 'logo-mark', kind: 'frame', parent: 'root', name: 'Logo Mark',
  position: 'absolute', children: [],
  size: { width: 64, height: 64 },
  transform: { x: 688, y: 200, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {
    fill: { kind: 'solid', color: '#E54D2E' },
    cornerRadius: 16,
  },
} as NodeJson)
addChild({
  id: 'logo-n', kind: 'text', parent: 'logo-mark',
  position: 'absolute',
  text: 'N', fontFamily: 'Inter', fontSize: 36, fontWeight: 800,
  color: '#ffffff', textAlign: 'center',
  size: { width: 64, height: 64 },
  transform: { x: 0, y: 12, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson, 'logo-mark')

// Brand name
addToRoot({
  id: 'brand-name', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'nextbase', fontFamily: 'Inter', fontSize: 28, fontWeight: 700,
  color: '#ffffff', textAlign: 'center',
  size: { width: 300, height: 36 },
  transform: { x: 570, y: 284, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

// Tagline
addToRoot({
  id: 'brand-tag', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'Premium Next.js 14+ SaaS Starter Kit', fontFamily: 'Inter', fontSize: 14, fontWeight: 400,
  color: '#ffffff50', textAlign: 'center', letterSpacing: 0.5,
  size: { width: 400, height: 20 },
  transform: { x: 520, y: 326, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

fadeIn('logo-mark', 0.2, 0.8)
fadeIn('brand-name', 0.6, 0.8)
fadeIn('brand-tag', 1.0, 0.6)
slideUp('logo-mark', 0.2, 230, 200, 0.8)
slideUp('brand-name', 0.6, 300, 284, 0.6)

// ══════════════════════════════════════════════
// ACT 2: HEADLINE (2.5–5s)
// Logo group fades, headline takes over
// ══════════════════════════════════════════════

// Fade out logo group
const logoFadeOut = `op-${_tid++}`
tracks[logoFadeOut] = {
  id: logoFadeOut, nodeId: 'logo-mark', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${logoFadeOut}-0`, time: 0, value: 0 },
    { id: `${logoFadeOut}-1`, time: 1.0, value: 1 },
    { id: `${logoFadeOut}-2`, time: 2.2, value: 1 },
    { id: `${logoFadeOut}-3`, time: 2.8, value: 0 },
  ],
}
const brandFadeOut = `op-${_tid++}`
tracks[brandFadeOut] = {
  id: brandFadeOut, nodeId: 'brand-name', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${brandFadeOut}-0`, time: 0, value: 0 },
    { id: `${brandFadeOut}-1`, time: 0.6, value: 0 },
    { id: `${brandFadeOut}-2`, time: 1.4, value: 1 },
    { id: `${brandFadeOut}-3`, time: 2.2, value: 1 },
    { id: `${brandFadeOut}-4`, time: 2.8, value: 0 },
  ],
}
const tagFadeOut = `op-${_tid++}`
tracks[tagFadeOut] = {
  id: tagFadeOut, nodeId: 'brand-tag', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${tagFadeOut}-0`, time: 0, value: 0 },
    { id: `${tagFadeOut}-1`, time: 1.0, value: 0 },
    { id: `${tagFadeOut}-2`, time: 1.6, value: 1 },
    { id: `${tagFadeOut}-3`, time: 2.2, value: 1 },
    { id: `${tagFadeOut}-4`, time: 2.8, value: 0 },
  ],
}

// Main headline — BIG, centered
addToRoot({
  id: 'headline', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'Build your SaaS', fontFamily: 'Inter', fontSize: 64, fontWeight: 700,
  color: '#ffffff', textAlign: 'center', lineHeight: 1.1,
  size: { width: 800, height: 76 },
  transform: { x: 320, y: 320, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

addToRoot({
  id: 'headline-2', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'product in a weekend.', fontFamily: 'Inter', fontSize: 64, fontWeight: 700,
  color: '#ffffff', textAlign: 'center', lineHeight: 1.1,
  size: { width: 800, height: 76 },
  transform: { x: 320, y: 396, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

addToRoot({
  id: 'sub-headline', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'Start your SaaS with auth, payments, organizations,\nedge functions, admin panel, blog, feedback and more.',
  fontFamily: 'Inter', fontSize: 18, fontWeight: 400,
  color: '#ffffff55', textAlign: 'center', lineHeight: 1.6,
  size: { width: 700, height: 60 },
  transform: { x: 370, y: 500, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

fadeIn('headline', 3.0, 0.7)
fadeIn('headline-2', 3.3, 0.7)
fadeIn('sub-headline', 3.8, 0.6)
slideUp('headline', 3.0, 340, 320, 0.7)
slideUp('headline-2', 3.3, 416, 396, 0.7)
slideUp('sub-headline', 3.8, 520, 500, 0.6)

// Fade out headlines before features
const hlFade1 = `op-${_tid++}`
tracks[hlFade1] = {
  id: hlFade1, nodeId: 'headline', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${hlFade1}-0`, time: 0, value: 0 },
    { id: `${hlFade1}-1`, time: 3.0, value: 0 },
    { id: `${hlFade1}-2`, time: 3.7, value: 1 },
    { id: `${hlFade1}-3`, time: 5.5, value: 1 },
    { id: `${hlFade1}-4`, time: 6.0, value: 0 },
  ],
}
const hlFade2 = `op-${_tid++}`
tracks[hlFade2] = {
  id: hlFade2, nodeId: 'headline-2', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${hlFade2}-0`, time: 0, value: 0 },
    { id: `${hlFade2}-1`, time: 3.3, value: 0 },
    { id: `${hlFade2}-2`, time: 4.0, value: 1 },
    { id: `${hlFade2}-3`, time: 5.5, value: 1 },
    { id: `${hlFade2}-4`, time: 6.0, value: 0 },
  ],
}
const subFade = `op-${_tid++}`
tracks[subFade] = {
  id: subFade, nodeId: 'sub-headline', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${subFade}-0`, time: 0, value: 0 },
    { id: `${subFade}-1`, time: 3.8, value: 0 },
    { id: `${subFade}-2`, time: 4.4, value: 1 },
    { id: `${subFade}-3`, time: 5.5, value: 1 },
    { id: `${subFade}-4`, time: 6.0, value: 0 },
  ],
}

// ══════════════════════════════════════════════
// ACT 3: FEATURES GRID (6–10s)
// Section title + 6 feature cards, staggered
// ══════════════════════════════════════════════

addToRoot({
  id: 'feat-title', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'Everything you need to ship fast', fontFamily: 'Inter', fontSize: 32, fontWeight: 700,
  color: '#ffffff', textAlign: 'center',
  size: { width: 600, height: 40 },
  transform: { x: 420, y: 140, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

fadeIn('feat-title', 6.2, 0.6)
slideUp('feat-title', 6.2, 160, 140, 0.6)

const features = [
  { title: 'Authentication', desc: '15+ social logins with\nSupabase Auth', color: '#3ecf8e' },
  { title: 'Admin Panel', desc: 'User management with\nimpersonation', color: '#f5a623' },
  { title: 'Payments', desc: 'Stripe or Lemon Squeezy\nsubscriptions', color: '#a78bfa' },
  { title: 'Responsive UI', desc: 'Accessible components\nbuilt on shadcn/ui', color: '#60a5fa' },
  { title: 'MDX Content', desc: 'Blog and documentation\nsites out of the box', color: '#f472b6' },
  { title: 'Feedback', desc: 'Collect feedback and\nshare changelogs', color: '#E54D2E' },
]

features.forEach((f, i) => {
  const col = i % 3
  const row = Math.floor(i / 3)
  const cx = 220 + col * 350
  const cy = 220 + row * 230
  const t = 6.5 + i * 0.3

  // Card frame
  addToRoot({
    id: `fc-${i}`, kind: 'frame', parent: 'root', name: f.title,
    position: 'absolute', children: [],
    size: { width: 310, height: 190 },
    transform: { x: cx, y: cy, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {
      fill: { kind: 'solid', color: '#111116' },
      cornerRadius: 16,
      stroke: { color: '#ffffff12', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
    },
  } as NodeJson)

  // Color accent bar at top
  addChild({
    id: `fc-${i}-bar`, kind: 'rect', parent: `fc-${i}`,
    position: 'absolute',
    size: { width: 40, height: 4 },
    transform: { x: 24, y: 24, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: { fill: { kind: 'solid', color: f.color }, cornerRadius: 2 },
  } as NodeJson, `fc-${i}`)

  // Feature title
  addChild({
    id: `fc-${i}-t`, kind: 'text', parent: `fc-${i}`,
    position: 'absolute',
    text: f.title, fontFamily: 'Inter', fontSize: 20, fontWeight: 600,
    color: '#ffffff', textAlign: 'start',
    size: { width: 260, height: 26 },
    transform: { x: 24, y: 48, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {},
  } as NodeJson, `fc-${i}`)

  // Feature description
  addChild({
    id: `fc-${i}-d`, kind: 'text', parent: `fc-${i}`,
    position: 'absolute',
    text: f.desc, fontFamily: 'Inter', fontSize: 14, fontWeight: 400,
    color: '#ffffff55', textAlign: 'start', lineHeight: 1.5,
    size: { width: 260, height: 44 },
    transform: { x: 24, y: 88, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {},
  } as NodeJson, `fc-${i}`)

  // Colored icon dot
  addChild({
    id: `fc-${i}-dot`, kind: 'rect', parent: `fc-${i}`,
    position: 'absolute',
    size: { width: 36, height: 36 },
    transform: { x: 24, y: 140, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: { fill: { kind: 'solid', color: f.color + '20' }, cornerRadius: 10 },
  } as NodeJson, `fc-${i}`)

  // Dot inner
  addChild({
    id: `fc-${i}-di`, kind: 'rect', parent: `fc-${i}`,
    position: 'absolute',
    size: { width: 12, height: 12 },
    transform: { x: 36, y: 152, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: { fill: { kind: 'solid', color: f.color }, cornerRadius: 6 },
  } as NodeJson, `fc-${i}`)

  fadeIn(`fc-${i}`, t, 0.5)
  slideUp(`fc-${i}`, t, cy + 30, cy, 0.6)
})

// Fade out features before next act
features.forEach((_, i) => {
  const fout = `op-${_tid++}`
  tracks[fout] = {
    id: fout, nodeId: `fc-${i}`, propertyId: 'appearance.opacity',
    keyframes: [
      { id: `${fout}-0`, time: 0, value: 0 },
      { id: `${fout}-1`, time: 6.5 + i * 0.3, value: 0 },
      { id: `${fout}-2`, time: 7.0 + i * 0.3, value: 1 },
      { id: `${fout}-3`, time: 9.8, value: 1 },
      { id: `${fout}-4`, time: 10.3, value: 0 },
    ],
  }
})
const ftFadeOut = `op-${_tid++}`
tracks[ftFadeOut] = {
  id: ftFadeOut, nodeId: 'feat-title', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${ftFadeOut}-0`, time: 0, value: 0 },
    { id: `${ftFadeOut}-1`, time: 6.2, value: 0 },
    { id: `${ftFadeOut}-2`, time: 6.8, value: 1 },
    { id: `${ftFadeOut}-3`, time: 9.8, value: 1 },
    { id: `${ftFadeOut}-4`, time: 10.3, value: 0 },
  ],
}

// ══════════════════════════════════════════════
// ACT 4: TECH STACK + CTA (10–14s)
// ══════════════════════════════════════════════

// Section title
addToRoot({
  id: 'stack-title', kind: 'text', parent: 'root',
  position: 'absolute',
  text: 'Choose your stack', fontFamily: 'Inter', fontSize: 28, fontWeight: 700,
  color: '#ffffff', textAlign: 'center',
  size: { width: 400, height: 36 },
  transform: { x: 520, y: 200, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

fadeIn('stack-title', 10.5, 0.5)

// Stack cards — horizontal row
const stacks = [
  { name: 'Supabase', desc: 'Postgres, Auth & Storage', color: '#3ecf8e' },
  { name: 'PlanetScale', desc: 'MySQL with Prisma ORM', color: '#8b8bff' },
  { name: 'Convex', desc: 'Reactive backend', color: '#f5a623' },
  { name: 'Cloudflare D1', desc: 'Edge SQLite', color: '#f6821f' },
]

stacks.forEach((s, i) => {
  const sx = 160 + i * 290
  const sy = 280
  const t = 10.8 + i * 0.25

  addToRoot({
    id: `sc-${i}`, kind: 'frame', parent: 'root', name: s.name,
    position: 'absolute', children: [],
    size: { width: 260, height: 100 },
    transform: { x: sx, y: sy, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {
      fill: { kind: 'solid', color: '#111116' },
      cornerRadius: 14,
      stroke: { color: s.color + '30', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
    },
  } as NodeJson)

  // Color dot
  addChild({
    id: `sc-${i}-dot`, kind: 'rect', parent: `sc-${i}`,
    position: 'absolute',
    size: { width: 10, height: 10 },
    transform: { x: 20, y: 22, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: { fill: { kind: 'solid', color: s.color }, cornerRadius: 5 },
  } as NodeJson, `sc-${i}`)

  addChild({
    id: `sc-${i}-name`, kind: 'text', parent: `sc-${i}`,
    position: 'absolute',
    text: s.name, fontFamily: 'Inter', fontSize: 16, fontWeight: 600,
    color: '#ffffff', textAlign: 'start',
    size: { width: 200, height: 22 },
    transform: { x: 40, y: 18, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {},
  } as NodeJson, `sc-${i}`)

  addChild({
    id: `sc-${i}-desc`, kind: 'text', parent: `sc-${i}`,
    position: 'absolute',
    text: s.desc, fontFamily: 'Inter', fontSize: 12, fontWeight: 400,
    color: '#ffffff50', textAlign: 'start',
    size: { width: 200, height: 16 },
    transform: { x: 40, y: 44, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {},
  } as NodeJson, `sc-${i}`)

  // Checkmark-like indicator
  addChild({
    id: `sc-${i}-chk`, kind: 'text', parent: `sc-${i}`,
    position: 'absolute',
    text: i === 0 ? '●' : '○', fontFamily: 'Inter', fontSize: 14, fontWeight: 400,
    color: i === 0 ? s.color : '#ffffff30', textAlign: 'end',
    size: { width: 30, height: 20 },
    transform: { x: 210, y: 20, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    appearance: {},
  } as NodeJson, `sc-${i}`)

  fadeIn(`sc-${i}`, t, 0.5)
  slideUp(`sc-${i}`, t, sy + 20, sy, 0.5)
})

// CTA button — centered below stacks
addToRoot({
  id: 'cta-btn', kind: 'frame', parent: 'root', name: 'CTA Button',
  position: 'absolute', children: [],
  size: { width: 200, height: 56 },
  transform: { x: 620, y: 440, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {
    fill: { kind: 'solid', color: '#ffffff' },
    cornerRadius: 28,
  },
} as NodeJson)
addChild({
  id: 'cta-label', kind: 'text', parent: 'cta-btn',
  position: 'absolute',
  text: 'Get Now →', fontFamily: 'Inter', fontSize: 16, fontWeight: 700,
  color: '#000000', textAlign: 'center',
  size: { width: 200, height: 56 },
  transform: { x: 0, y: 18, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson, 'cta-btn')

fadeIn('cta-btn', 11.8, 0.5)
slideUp('cta-btn', 11.8, 460, 440, 0.5)

// Testimonial line
addToRoot({
  id: 'testi-line', kind: 'text', parent: 'root',
  position: 'absolute',
  text: '"Nextbase will save you a great deal of time." — Romain, Sendshort.ai',
  fontFamily: 'Inter', fontSize: 15, fontWeight: 400,
  color: '#ffffff40', textAlign: 'center',
  size: { width: 600, height: 22 },
  transform: { x: 420, y: 530, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson)

fadeIn('testi-line', 12.2, 0.6)

// "NEW" badge at top
addToRoot({
  id: 'new-badge', kind: 'frame', parent: 'root', name: 'NEW Badge',
  position: 'absolute', children: [],
  size: { width: 280, height: 32 },
  transform: { x: 580, y: 600, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {
    fill: { kind: 'solid', color: '#ffffff06' },
    cornerRadius: 16,
    stroke: { color: '#ffffff10', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
  },
} as NodeJson)
addChild({
  id: 'new-pill', kind: 'frame', parent: 'new-badge',
  position: 'absolute', children: [],
  size: { width: 40, height: 20 },
  transform: { x: 6, y: 6, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: { fill: { kind: 'solid', color: '#E54D2E' }, cornerRadius: 10 },
} as NodeJson, 'new-badge')
addChild({
  id: 'new-pill-t', kind: 'text', parent: 'new-pill',
  position: 'absolute',
  text: 'NEW', fontFamily: 'Inter', fontSize: 9, fontWeight: 800,
  color: '#ffffff', textAlign: 'center',
  size: { width: 40, height: 20 },
  transform: { x: 0, y: 4, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson, 'new-pill')
addChild({
  id: 'new-badge-t', kind: 'text', parent: 'new-badge',
  position: 'absolute',
  text: 'Component Kit launching soon →', fontFamily: 'Inter', fontSize: 11, fontWeight: 500,
  color: '#ffffff70', textAlign: 'start',
  size: { width: 220, height: 20 },
  transform: { x: 52, y: 7, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  appearance: {},
} as NodeJson, 'new-badge')

fadeIn('new-badge', 12.5, 0.5)

// ══════════════════════════════════════════════
// CAMERA — subtle drift for cinematic feel
// ══════════════════════════════════════════════
nodes['cam'] = {
  id: 'cam', kind: 'camera', parent: null, name: 'Camera',
  enabled: true, focalLength: 1000,
  depthOfField: false, fStop: 8,
  focusMode: 'spatial',
  focusPlaneX: 720, focusPlaneY: 450, focusPlaneZ: 0,
  focusPlaneInitialized: true,
  focusPlaneRotationX: 0, focusPlaneRotationY: 0, focusPlaneRotationZ: 0,
  bladeCount: 6, blurLevel: 1, blurQuality: 24,
  bloomEnabled: false, bloomStrength: 0, bloomRadius: 0, bloomThreshold: 1,
  transform: { x: 720, y: 450, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
} as NodeJson

tracks['cam-x'] = {
  id: 'cam-x', nodeId: 'cam', propertyId: 'transform.x', defaultEasing: 'ease-in-out',
  keyframes: [
    { id: 'cx0', time: 0, value: 710 },
    { id: 'cx1', time: 7, value: 730 },
    { id: 'cx2', time: 14, value: 720 },
  ],
}
tracks['cam-y'] = {
  id: 'cam-y', nodeId: 'cam', propertyId: 'transform.y', defaultEasing: 'ease-in-out',
  keyframes: [
    { id: 'cy0', time: 0, value: 440 },
    { id: 'cy1', time: 7, value: 460 },
    { id: 'cy2', time: 14, value: 450 },
  ],
}

// ══════════════════════════════════════════════
// BUILD
// ══════════════════════════════════════════════
const scene: SceneJson = {
  meta: { name: 'Nextbase Demo', duration: 14, frameRate: 60, canvas: { width: W, height: H } },
  root: 'root',
  activeCameraId: 'cam',
  nodes,
  tracks,
}

const bytes = buildSceneBytes(scene)
const validation = validateScene(bytes)
if (!validation.ok) {
  console.error('Validation failed:', validation.errors)
  process.exit(1)
}

const summary = readSceneSummary(bytes)
const out = process.argv[2] ?? path.resolve(process.cwd(), 'nextbase-demo.hype')
const resolved = path.isAbsolute(out) ? out : path.resolve(process.cwd(), out)
fs.writeFileSync(resolved, Buffer.from(bytes))
console.log(`Wrote ${resolved} (${summary.layerCount} layers, ${Object.keys(tracks).length} tracks)`)
