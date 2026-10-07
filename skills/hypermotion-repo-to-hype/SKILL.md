---
name: hypermotion-repo-to-hype
description: Read any frontend repository and generate a cinematic product demo .hype scene — a sequenced 4-act reveal (logo → headline → features → CTA) with staggered animations, brand colors, and actual product copy. Pipeline-based, works on any repo.
---

# Repo → Hype (Product Demo Pipeline)

Convert a frontend repository into a **cinematic product demo** rendered as a `.hype` scene file. The output is a sequenced reveal — like an Apple keynote or product launch video — not a static UI mockup or a pile of floating cards.

## When to use

- "Convert this repo to a hype file"
- "Generate a hype from [repo path]"
- "Make a demo video from this codebase"

## Inputs

- **Repo path** — local filesystem path to the frontend project
- **Output path** (optional) — defaults to `<project-name>-demo.hype` in the Hypermotion root

---

## Pipeline

### Phase 1: Deep repo scan

Read the repo thoroughly. Everything downstream depends on this.

1. **Framework + entry point** — React/Next.js, Vue, Svelte, etc. Find the main page.
2. **Trace every imported component** on the main page. Read each one.
3. **Extract the product identity**:
   - Product name and tagline
   - Logo treatment (how do they display the brand? Icon + wordmark? Just text?)
   - One-liner value proposition (the `<h1>`)
   - Supporting copy (the subtitle/subheadline)
4. **Extract 5–7 key features** with their titles and one-line descriptions. Use the actual copy from the repo, not summaries.
5. **Extract the tech stack** — what backends/frameworks does it integrate with? What logos/names does it showcase?
6. **Capture design tokens**:
   - Primary accent color (resolve Tailwind classes → hex)
   - Background color (usually dark for hero sections)
   - Text colors (headline, body, muted)
   - Font family
7. **Find social proof** — a short testimonial quote + author name/role
8. **Find the CTA** — what's the main button text? ("Get Started", "Try Free", etc.)

### Phase 2: Scene architecture — the 4-act narrative

The scene tells a story in **4 acts**. Each act occupies a portion of the timeline. Elements from one act **fade out** before the next act begins, keeping the screen clean.

**Canvas**: 1440×900, duration 14 seconds, 60fps.

**Background**: Dark — use the product's darkest brand color or `#000000` with a subtle radial gradient.

```
Timeline (14 seconds):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACT 1        ACT 2          ACT 3           ACT 4
Logo +       Headline +     Features        Stack +
Brand        Subtitle       Grid            CTA
0───2.5s───3───5.5s───6────────10s──────10.5────14s
         ↑fade out      ↑fade out          ↑stays
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Act 1: Logo + Brand (0–2.5s)
- Logo mark (colored frame with brand initial, centered upper-third)
- Brand name (large text below logo)
- Tagline (smaller muted text below)
- Each element fades in + slides up with 0.3–0.4s stagger
- All three fade out at 2.2–2.8s

#### Act 2: Headline (3–5.5s)
- Big headline text (48–64px, centered, bold white)
- Split across 2 lines if needed for impact
- Subtitle fades in below (18px, muted)
- Each line fades in + slides up with stagger
- All fade out at 5.5–6.0s

#### Act 3: Features Grid (6–10s)
- Section title ("Everything you need" or similar from repo)
- 6 feature cards in a 3×2 grid, centered
- Cards appear **one by one** with 0.3s stagger — this is the hero moment
- Each card has: accent color bar, title, description, colored icon
- All fade out at 9.8–10.3s

#### Act 4: Stack + CTA (10.5–14s)
- "Choose your stack" or equivalent section title
- 3–4 stack/integration cards in a horizontal row
- CTA button (white, pill-shaped, centered)
- Testimonial quote line (muted, below CTA)
- Optional "NEW" badge pill
- These stay visible through end (no fade out)

### Phase 3: Animation patterns

Every element gets **two animations**: fade-in (opacity 0→1) and slide-up (y offset 20–30px → final position). This creates a polished, cohesive feel.

#### Fade-in + slide-up (the core pattern)
```typescript
// Reusable helpers
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
```

#### Fade-out (to clear the stage between acts)
```typescript
const fout = `op-${_tid++}`
tracks[fout] = {
  id: fout, nodeId: 'element-id', propertyId: 'appearance.opacity',
  keyframes: [
    { id: `${fout}-0`, time: 0, value: 0 },
    { id: `${fout}-1`, time: appearTime, value: 0 },
    { id: `${fout}-2`, time: appearTime + 0.7, value: 1 },
    { id: `${fout}-3`, time: fadeOutStart, value: 1 },
    { id: `${fout}-4`, time: fadeOutStart + 0.5, value: 0 },
  ],
}
```

When an element has both a simple `fadeIn()` track AND a full fade-in/fade-out track on the same property, the full track takes precedence — use only one opacity track per node. For elements that fade out, use the full pattern instead of the `fadeIn()` helper.

#### Camera drift (subtle, full duration)
```typescript
tracks['cam-x'] = {
  id: 'cam-x', nodeId: 'cam', propertyId: 'transform.x', defaultEasing: 'ease-in-out',
  keyframes: [
    { id: 'cx0', time: 0, value: 710 },
    { id: 'cx1', time: 7, value: 730 },
    { id: 'cx2', time: 14, value: 720 },
  ],
}
```

#### Staggered grid entrance
```typescript
features.forEach((f, i) => {
  const col = i % 3
  const row = Math.floor(i / 3)
  const cx = 220 + col * 350
  const cy = 220 + row * 230
  const t = 6.5 + i * 0.3  // 0.3s stagger between each card

  // ... create card frame + children ...

  fadeIn(`fc-${i}`, t, 0.5)
  slideUp(`fc-${i}`, t, cy + 30, cy, 0.6)
})
```

### Phase 4: Rendering rules (CRITICAL)

1. **Text must be children of frames, never root.** Text is painted into its parent frame's canvas texture. Text directly under root DOES work in flat mode but looks better inside styled card frames.

2. **Coordinates are relative to parent.** Text at `{ x: 24, y: 48 }` inside a card is 24px from the card's left edge.

3. **Use flat renderMode throughout.** Do NOT use `renderMode: 'plane'` on large containers with many children — it creates a single canvas texture that can fail. The reference scenes (45–148 layers) all use flat renderMode.

4. **Opacity tracks for visibility, not static opacity.** `appearance: { opacity: 0 }` is unreliable. Always use keyframe tracks.

5. **No DOF, no bloom, no rotationY.** These cause blank renders.

6. **One opacity track per node.** If a node needs fade-in AND fade-out, combine them into one track with all keyframes.

### Phase 5: UI element recipes

#### Feature card
```typescript
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
})
// Accent bar
addChild({ id: `fc-${i}-bar`, kind: 'rect', size: { width: 40, height: 4 },
  transform: { x: 24, y: 24, ... },
  appearance: { fill: { kind: 'solid', color: f.color }, cornerRadius: 2 },
}, `fc-${i}`)
// Title
addChild({ id: `fc-${i}-t`, kind: 'text', text: f.title,
  fontSize: 20, fontWeight: 600, color: '#ffffff', ... }, `fc-${i}`)
// Description
addChild({ id: `fc-${i}-d`, kind: 'text', text: f.desc,
  fontSize: 14, fontWeight: 400, color: '#ffffff55', lineHeight: 1.5, ... }, `fc-${i}`)
```

#### Logo mark
```typescript
addToRoot({
  id: 'logo-mark', kind: 'frame', children: [],
  size: { width: 64, height: 64 },
  transform: { x: W/2 - 32, y: 200, ... },
  appearance: { fill: { kind: 'solid', color: brandAccent }, cornerRadius: 16 },
})
addChild({ id: 'logo-letter', kind: 'text', text: brandInitial,
  fontSize: 36, fontWeight: 800, color: '#ffffff', textAlign: 'center',
  size: { width: 64, height: 64 }, ... }, 'logo-mark')
```

#### CTA button
```typescript
addToRoot({
  id: 'cta-btn', kind: 'frame', children: [],
  size: { width: 200, height: 56 },
  transform: { x: W/2 - 100, y: 440, ... },
  appearance: { fill: { kind: 'solid', color: '#ffffff' }, cornerRadius: 28 },
})
addChild({ id: 'cta-label', kind: 'text', text: 'Get Now →',
  fontSize: 16, fontWeight: 700, color: '#000000', textAlign: 'center',
  size: { width: 200, height: 56 },
  transform: { x: 0, y: 18, ... }, ... }, 'cta-btn')
```

#### Stack/integration card
```typescript
addToRoot({
  id: `sc-${i}`, kind: 'frame', children: [],
  size: { width: 260, height: 100 },
  appearance: {
    fill: { kind: 'solid', color: '#111116' },
    cornerRadius: 14,
    stroke: { color: stackColor + '30', width: 1, ... },
  },
})
// Color dot + name + description inside
```

### Phase 6: Build and deliver

Write `cli/src/scene/<projectName>Demo.ts`:

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { buildSceneBytes, readSceneSummary, validateScene, type SceneJson, type NodeJson, type TrackJson } from './build.js'

// ... scene construction ...

const bytes = buildSceneBytes(scene)
const validation = validateScene(bytes)
if (!validation.ok) { console.error(validation.errors); process.exit(1) }

const summary = readSceneSummary(bytes)
const out = process.argv[2] ?? path.resolve(process.cwd(), '<project>-demo.hype')
fs.writeFileSync(out, Buffer.from(bytes))
console.log(`Wrote ${out} (${summary.layerCount} layers, ${Object.keys(tracks).length} tracks)`)
```

Run: `npx tsx cli/src/scene/<projectName>Demo.ts`

## Camera template

```typescript
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
```

## Quality checklist

- [ ] **4-act sequence** — logo, headline, features, CTA — not all at once
- [ ] **Elements fade out** between acts (clean stage transitions)
- [ ] **Every element** has fade-in + slide-up animation
- [ ] **Staggered entrances** for grid items (0.25–0.3s apart)
- [ ] **Actual product copy** from the repo (headlines, feature names, tagline)
- [ ] **Brand accent color** from the repo (not generic purple)
- [ ] **60–80 layers**, 40–60 tracks (quality over quantity)
- [ ] Text is large enough to read (headlines 48-64px, body 14-18px)
- [ ] One opacity track per node (no conflicting tracks)
- [ ] No renderMode: 'plane' on containers with many children
- [ ] DOF off, bloom off, no rotationY
- [ ] `validateScene()` returns `ok: true`
- [ ] Camera drift (subtle X/Y over full duration)

## Opening the file

**File > Open** in Hypermotion → select the `.hype` file.

Do NOT launch via CLI args — IndexedDB persistence race condition causes blank screens. If the screen is blank, clear IndexedDB (DevTools → Application → IndexedDB → delete all) and relaunch.

```
env -u ELECTRON_RUN_AS_NODE pnpm exec vite          # terminal 1
env -u ELECTRON_RUN_AS_NODE pnpm exec electron .     # terminal 2
```
