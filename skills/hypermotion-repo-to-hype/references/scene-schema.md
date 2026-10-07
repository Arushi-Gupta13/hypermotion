# SceneJson schema reference

The `.hype` format is a Yjs CRDT document produced by `buildSceneBytes(scene: SceneJson)` in `cli/src/scene/build.ts`.

## Top-level structure

```typescript
interface SceneJson {
  meta: {
    name: string
    duration: number          // seconds
    frameRate: number         // typically 60
    canvas: { width: number; height: number }
  }
  root: string               // id of the root frame node
  activeCameraId?: string     // id of the active camera node
  nodes: Record<string, NodeJson>
  tracks: Record<string, TrackJson>
}
```

## Node hierarchy rules

**Root frame**: `renderMode: 'flat'` (default). Contains card frames as children.

**Card frames**: Direct children of root. Use `renderMode: 'plane'` to participate in 3D. Set `clipsContent: false`.

**Text nodes**: Children of card frames (NEVER root). Use default `renderMode` (omit it). Coordinates are relative to parent frame.

**Button frames**: Children of card frames. Text label is a child of the button frame.

```
root (frame, flat)
├── hero-card (frame, plane, clipsContent: false)
│   ├── title (text, relative coords)
│   ├── subtitle (text, relative coords)
│   └── cta-btn (frame)
│       └── cta-label (text, relative to button)
├── form-card (frame, plane, clipsContent: false)
│   ├── form-title (text)
│   ├── email-input (frame)
│   └── email-text (text)
└── cam (camera, no parent)
```

## NodeJson

```typescript
interface NodeJson {
  id: string
  kind: 'frame' | 'rect' | 'ellipse' | 'text' | 'image' | 'shader' |
        'video' | 'audio' | 'component' | 'instance' | 'camera'
  name?: string
  parent?: string | null
  children?: string[]
  visible?: boolean
  position?: 'flow' | 'absolute'
  clipsContent?: boolean        // set false on card frames

  transform?: {
    x: number
    y: number
    z?: number
    rotation: number
    scaleX: number
    scaleY: number
    renderMode?: 'flat' | 'plane' | 'group3d'  // only set on card frames
  }

  appearance?: AppearanceJson
  size?: { width?: number | 'hug' | 'fill'; height?: number | 'hug' | 'fill' }

  // Text-node properties (kind: 'text')
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'start' | 'center' | 'end'
  color?: string

  // Camera-node properties (kind: 'camera')
  enabled?: boolean
  focalLength?: number
  depthOfField?: boolean        // keep false
  focusMode?: 'spatial'
  focusPlaneX?: number
  focusPlaneY?: number
  focusPlaneZ?: number
  focusPlaneInitialized?: boolean
  focusPlaneRotationX?: number
  focusPlaneRotationY?: number
  focusPlaneRotationZ?: number
  fStop?: number                // use 8
  bladeCount?: number
  blurLevel?: number
  blurQuality?: number
  bloomEnabled?: boolean        // keep false
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
}
```

## AppearanceJson

```typescript
interface AppearanceJson {
  opacity?: number            // 0–1; use tracks for animation (static opacity unreliable)
  fill?: FillJson | null
  stroke?: StrokeJson | null
  cornerRadius?: number
}
```

## FillJson

```typescript
type FillJson =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; stops: GradientStopJson[]; angle: number }
  | { kind: 'radial'; stops: GradientStopJson[]; cx: number; cy: number; shape: 'circle' | 'ellipse' }

interface GradientStopJson { at: number; color: string }
```

## StrokeJson

```typescript
interface StrokeJson {
  color: string
  width: number
  align: 'inside' | 'center' | 'outside'
  style: 'solid' | 'dashed' | 'dotted'
  dashLength: number
  dashGap: number
}
```

## TrackJson

```typescript
interface TrackJson {
  id: string
  nodeId: string
  propertyId: string
  defaultEasing?: string      // 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  textAnimation?: TextAnimationJson | null
  keyframes: KeyframeJson[]
}

interface KeyframeJson {
  id: string
  time: number                // seconds
  value: number | string | boolean | object
}
```

## TextAnimationJson

For letter-by-letter typing effects. Goes on the track, not the node:

```typescript
interface TextAnimationJson {
  id: string
  mode: 'in' | 'out'
  applyTo: 'layer' | 'letters' | 'words' | 'lines'
  order: 'forward' | 'reverse' | 'random'
  delay: number               // seconds between segments
  smoothing: 'none' | 'soft' | 'smooth'
  duration: number             // total animation duration
  startTime: number            // when the animation begins
  acceleration: 'linear' | 'speed-up' | 'slow-down' | 'smooth' | 'spring'
  easingPresetId: string       // 'none', 'smooth', etc.
  easingStrength: number
  direction: 'up' | 'down' | 'left' | 'right'
  travelDistance: number       // pixels each segment travels
  blurRadius: number
}
```

## Animatable property IDs

Transform: `transform.x`, `transform.y`, `transform.z`, `transform.rotation`, `transform.scaleX`, `transform.scaleY`

Appearance: `appearance.opacity`, `appearance.cornerRadius`, `appearance.fill`

Camera: `camera.focusPlaneX`, `camera.focusPlaneY`, `camera.focusPlaneZ`, `camera.fStop`
