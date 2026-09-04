// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'

export const MAX_DOF_KERNEL_SAMPLES = 48

export type DofPreviewQuality = 'draft' | 'balanced' | 'high'

export interface DofSampleBudgetContext {
  playing: boolean
  interactive: boolean
  finalRender: boolean
}

export interface PlaneDepthOfFieldShaderState {
  enabled: boolean
  blurPx: number
  minimumBlurPx: number
  planeWidth: number
  planeHeight: number
  focusMask: boolean
  focusX: number
  focusY: number
  focusRadius: number
  focusFalloff: number
  /** Drawing-buffer pixels per composition pixel. */
  screenPixelRatio: number
  sampleCount: number
  bladeCount: number
  bladeRotation: number
  bokehRatio: number
  bend?: PlaneBendShaderState | null
}

export interface PlaneBendShaderState {
  enabled: boolean
  angle: number
  factor: number
  bothDirections: boolean
  limitToRegion: boolean
  captureDirection: { x: number; y: number; z: number }
  captureRotation: number
  upDirection: { x: number; y: number; z: number }
  upRotation: number
  bendRotation: number
  captureOrigin: { x: number; y: number; z: number }
  resolvedLength: number
}

interface DofShaderUniforms {
  hmDofEnabled: { value: number }
  hmDofBlur: { value: number }
  hmDofMinBlur: { value: number }
  hmPlaneSize: { value: THREE.Vector2 }
  hmFocusMask: { value: number }
  hmFocusCenter: { value: THREE.Vector2 }
  hmFocusRadius: { value: number }
  hmFocusFalloff: { value: number }
  hmScreenPixelRatio: { value: number }
  hmSampleCount: { value: number }
  hmApertureStretch: { value: number }
  hmDofKernel: { value: THREE.Vector2[] }
  hmBendEnabled: { value: number }
  hmBendAngle: { value: number }
  hmBendFactor: { value: number }
  hmBendBothDirections: { value: number }
  hmBendLimitToRegion: { value: number }
  hmBendCaptureDirection: { value: THREE.Vector3 }
  hmBendCaptureRotation: { value: number }
  hmBendUpDirection: { value: THREE.Vector3 }
  hmBendUpRotation: { value: number }
  hmBendRotation: { value: number }
  hmBendCaptureOrigin: { value: THREE.Vector3 }
  hmBendCaptureLength: { value: number }
}

const DOF_SHADER_KEY = 'hypermotion-gpu-dof-bend-v11'
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const kernelCache = new Map<string, THREE.Vector2[]>()

/**
 * Bound interactive work independently of the authored/final quality.
 * Timeline and camera gestures always use the realtime budget; paused preview
 * and export can spend progressively more samples without changing the scene.
 */
export function depthOfFieldSampleCount(
  previewQuality: DofPreviewQuality,
  blurQuality: number,
  context: DofSampleBudgetContext,
): number {
  if (context.playing || context.interactive) {
    if (context.playing) {
      // Motion clarity wins while the clock is advancing. Paused preview and
      // export immediately restore their larger authored-quality budgets.
      return previewQuality === 'high'
        ? 6
        : previewQuality === 'balanced'
          ? 4
          : 3
    }
    return previewQuality === 'high'
      ? 12
      : previewQuality === 'balanced'
        ? 8
        : 6
  }
  if (context.finalRender) {
    // Final output must never fall below the Balanced paused-preview budget.
    // Older scenes may still carry the legacy default (8), so enforce the
    // effective floor here instead of relying only on newly-authored values.
    return clampInt(Math.round(blurQuality), 24, MAX_DOF_KERNEL_SAMPLES)
  }
  switch (previewQuality) {
    case 'draft':
      return 6
    case 'high':
      return 48
    default:
      return 24
  }
}

/**
 * Deterministic Vogel-disc samples shaped by a regular aperture polygon.
 * Kernel generation happens on the CPU only when lens-shape controls change;
 * the fragment shader receives ready-to-use offsets and avoids per-pixel trig.
 */
export function createApertureKernel(
  sampleCount: number,
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
): Array<{ x: number; y: number }> {
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const blades = clampInt(bladeCount, 3, 16)
  const ratio = clamp(bokehRatio, 0.25, 4)
  const ratioX = Math.sqrt(ratio)
  const ratioY = 1 / ratioX
  const rotation = THREE.MathUtils.degToRad(rotationDegrees)
  const sector = (Math.PI * 2) / blades
  const polygonNumerator = Math.cos(Math.PI / blades)

  const samples = Array.from({ length: count }, (_, index) => {
    const angle = index * GOLDEN_ANGLE + rotation
    const radius = Math.sqrt((index + 0.5) / count)
    const wrapped = positiveModulo(angle + sector / 2, sector) - sector / 2
    const polygonRadius = polygonNumerator / Math.max(0.001, Math.cos(wrapped))
    const shapedRadius = radius * polygonRadius
    return {
      x: Math.cos(angle) * shapedRadius * ratioX,
      y: Math.sin(angle) * shapedRadius * ratioY,
    }
  })
  // Sample budgets change between playback and paused preview. Recenter every
  // budget so the convolution never nudges the image when that switch occurs.
  const centroid = samples.reduce(
    (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
    { x: 0, y: 0 },
  )
  centroid.x /= samples.length
  centroid.y /= samples.length
  return samples.map((sample) => ({
    x: sample.x - centroid.x,
    y: sample.y - centroid.y,
  }))
}

export function installDepthOfFieldShader(material: THREE.MeshBasicMaterial) {
  const installedUniforms = material.userData.hyperMotionDofUniforms
  if (
    material.userData.hyperMotionDofShaderKey === DOF_SHADER_KEY &&
    hasCurrentUniformSchema(installedUniforms)
  ) {
    return
  }
  const uniforms: DofShaderUniforms = {
    hmDofEnabled: { value: 0 },
    hmDofBlur: { value: 0 },
    hmDofMinBlur: { value: 0 },
    hmPlaneSize: { value: new THREE.Vector2(1, 1) },
    hmFocusMask: { value: 0 },
    hmFocusCenter: { value: new THREE.Vector2(0.5, 0.5) },
    hmFocusRadius: { value: 0 },
    hmFocusFalloff: { value: 1 },
    hmScreenPixelRatio: { value: 1 },
    hmSampleCount: { value: 1 },
    hmApertureStretch: { value: 1 },
    hmDofKernel: {
      value: apertureKernelVectors(7, 0, 1, 1),
    },
    hmBendEnabled: { value: 0 },
    hmBendAngle: { value: 0 },
    hmBendFactor: { value: 1 },
    hmBendBothDirections: { value: 0 },
    hmBendLimitToRegion: { value: 1 },
    hmBendCaptureDirection: { value: new THREE.Vector3(1, 0, 0) },
    hmBendCaptureRotation: { value: 0 },
    hmBendUpDirection: { value: new THREE.Vector3(0, 1, 0) },
    hmBendUpRotation: { value: 0 },
    hmBendRotation: { value: 0 },
    hmBendCaptureOrigin: { value: new THREE.Vector3() },
    hmBendCaptureLength: { value: 1 },
  }
  material.userData.hyperMotionDofShaderKey = DOF_SHADER_KEY
  material.userData.hyperMotionDofUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${BEND_VERTEX_DECLARATIONS}\nvoid main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed = hmApplyBend(transformed);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>

uniform float hmDofEnabled;
uniform float hmDofBlur;
uniform float hmDofMinBlur;
uniform vec2 hmPlaneSize;
uniform float hmFocusMask;
uniform vec2 hmFocusCenter;
uniform float hmFocusRadius;
uniform float hmFocusFalloff;
uniform float hmScreenPixelRatio;
uniform float hmSampleCount;
uniform float hmApertureStretch;
uniform vec2 hmDofKernel[${MAX_DOF_KERNEL_SAMPLES}];`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP

  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float hmFocusBlend = 1.0;
  if ( hmFocusMask > 0.5 ) {
    // Point focus is authored in composition pixels and must stay circular in
    // camera space. Measuring it in plane UVs sheared the mask on tilted cards.
    vec2 hmFragmentPosition = gl_FragCoord.xy / max(hmScreenPixelRatio, 0.001);
    vec2 hmFocusDelta = hmFragmentPosition - hmFocusCenter;
    hmFocusBlend = smoothstep(
      hmFocusRadius,
      hmFocusRadius + max( hmFocusFalloff, 0.001 ),
      length( hmFocusDelta )
    );
  }

  float hmLocalBlur = mix( hmDofMinBlur, hmDofBlur, hmFocusBlend );
  // Circle of confusion grows continuously across the authored falloff: zero
  // inside the sharp radius, progressively wider through the transition, and
  // equal to Max Blur beyond the outer radius.
  float hmKernelBlur = hmLocalBlur;
  // Derivatives must be evaluated in uniform control flow. hmKernelBlur varies
  // across the focus falloff, so computing them inside the blur branch leaves
  // results undefined at the sharp/blur boundary on some GPUs.
  vec2 hmUvDx = dFdx(vMapUv);
  vec2 hmUvDy = dFdy(vMapUv);
  if ( hmDofEnabled > 0.5 && hmKernelBlur > 0.05 && hmSampleCount > 0.5 ) {
    // The authored sample count is the whole aperture kernel. Keeping an
    // additional unblurred texel here left a visible sharp copy in the middle
    // of defocused text, particularly in the six-sample playback budget.
    vec3 hmPremultiplied = vec3( 0.0 );
    float hmAlpha = 0.0;
    float hmWeight = 0.0;
    float hmKernelRadiusPx = hmKernelBlur * max(hmScreenPixelRatio, 0.001);
    // Approximate the continuous aperture area represented by every discrete
    // tap. Sparse realtime kernels receive a wider prefilter than 48-tap still
    // previews, closing the gaps that otherwise appear as repeated glyphs.
    float hmSampleSpacing =
      hmKernelRadiusPx * hmApertureStretch /
      sqrt(max(hmSampleCount, 1.0));
    float hmMipBias = clamp(
      log2(max(1.0, hmSampleSpacing)) + 0.75,
      0.0,
      6.0
    );
    float hmGradientScale = exp2(hmMipBias);
    for ( int hmIndex = 0; hmIndex < ${MAX_DOF_KERNEL_SAMPLES}; hmIndex ++ ) {
      if ( float( hmIndex ) < hmSampleCount ) {
        vec2 hmScreenOffset = hmDofKernel[hmIndex] * hmKernelRadiusPx;
        // Convert camera/screen-pixel aperture offsets into this fragment's UV
        // basis. The lens shape now stays stable under plane tilt/perspective.
        vec2 hmRawUv = vMapUv +
          hmUvDx * hmScreenOffset.x +
          hmUvDy * hmScreenOffset.y;
        float hmInside =
          step(0.0, hmRawUv.x) * step(hmRawUv.x, 1.0) *
          step(0.0, hmRawUv.y) * step(hmRawUv.y, 1.0);
        vec2 hmUv = clamp(hmRawUv, vec2( 0.0 ), vec2( 1.0 ));
        vec4 hmTap = texture2DGradEXT(
          map,
          hmUv,
          hmUvDx * hmGradientScale,
          hmUvDy * hmGradientScale
        );
        hmTap *= hmInside;
        hmPremultiplied += hmTap.rgb * hmTap.a;
        hmAlpha += hmTap.a;
        hmWeight += 1.0;
      }
    }
    sampledDiffuseColor = vec4(
      hmPremultiplied / max( hmAlpha, 0.00001 ),
      hmAlpha / hmWeight
    );
  }

  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
  #endif

  diffuseColor *= sampledDiffuseColor;

#endif`,
      )
  }
  material.customProgramCacheKey = () => DOF_SHADER_KEY
  material.needsUpdate = true
}

function hasCurrentUniformSchema(value: unknown): value is DofShaderUniforms {
  if (!value || typeof value !== 'object') return false
  const uniforms = value as Partial<Record<keyof DofShaderUniforms, unknown>>
  return [
    'hmDofEnabled',
    'hmDofBlur',
    'hmDofMinBlur',
    'hmPlaneSize',
    'hmFocusMask',
    'hmFocusCenter',
    'hmFocusRadius',
    'hmFocusFalloff',
    'hmScreenPixelRatio',
    'hmSampleCount',
    'hmApertureStretch',
    'hmDofKernel',
    'hmBendEnabled',
    'hmBendAngle',
    'hmBendFactor',
    'hmBendBothDirections',
    'hmBendLimitToRegion',
    'hmBendCaptureDirection',
    'hmBendCaptureRotation',
    'hmBendUpDirection',
    'hmBendUpRotation',
    'hmBendRotation',
    'hmBendCaptureOrigin',
    'hmBendCaptureLength',
  ].every((key) => uniforms[key as keyof DofShaderUniforms] != null)
}

export function updateDepthOfFieldShader(
  material: THREE.MeshBasicMaterial,
  state: PlaneDepthOfFieldShaderState,
) {
  installDepthOfFieldShader(material)
  const uniforms = material.userData.hyperMotionDofUniforms as DofShaderUniforms
  uniforms.hmDofEnabled.value = state.enabled && state.blurPx > 0.05 ? 1 : 0
  uniforms.hmDofBlur.value = Math.max(0, state.blurPx)
  uniforms.hmDofMinBlur.value = Math.max(
    0,
    Math.min(state.blurPx, state.minimumBlurPx),
  )
  uniforms.hmPlaneSize.value.set(
    Math.max(1, state.planeWidth),
    Math.max(1, state.planeHeight),
  )
  uniforms.hmFocusMask.value = state.focusMask ? 1 : 0
  uniforms.hmFocusCenter.value.set(
    state.focusX,
    state.focusY,
  )
  uniforms.hmFocusRadius.value = Math.max(0, state.focusRadius)
  uniforms.hmFocusFalloff.value = Math.max(0.001, state.focusFalloff)
  uniforms.hmScreenPixelRatio.value = Math.max(0.001, state.screenPixelRatio)
  const sampleCount = clampInt(
    state.sampleCount,
    1,
    MAX_DOF_KERNEL_SAMPLES,
  )
  uniforms.hmSampleCount.value = sampleCount
  const safeBokehRatio = clamp(state.bokehRatio, 0.25, 4)
  uniforms.hmApertureStretch.value = Math.max(
    Math.sqrt(safeBokehRatio),
    1 / Math.sqrt(safeBokehRatio),
  )
  uniforms.hmDofKernel.value = apertureKernelVectors(
    state.bladeCount,
    state.bladeRotation,
    state.bokehRatio,
    sampleCount,
  )
  const bend = state.bend
  uniforms.hmBendEnabled.value = bend?.enabled ? 1 : 0
  uniforms.hmBendAngle.value = THREE.MathUtils.degToRad(bend?.angle ?? 0)
  uniforms.hmBendFactor.value = clamp(bend?.factor ?? 0, 0, 1)
  uniforms.hmBendBothDirections.value = bend?.bothDirections ? 1 : 0
  uniforms.hmBendLimitToRegion.value = bend?.limitToRegion ? 1 : 0
  uniforms.hmBendCaptureDirection.value.set(
    bend?.captureDirection.x ?? 1,
    bend?.captureDirection.y ?? 0,
    bend?.captureDirection.z ?? 0,
  )
  uniforms.hmBendCaptureRotation.value = THREE.MathUtils.degToRad(
    bend?.captureRotation ?? 0,
  )
  uniforms.hmBendUpDirection.value.set(
    bend?.upDirection.x ?? 0,
    bend?.upDirection.y ?? 1,
    bend?.upDirection.z ?? 0,
  )
  uniforms.hmBendUpRotation.value = THREE.MathUtils.degToRad(
    bend?.upRotation ?? 0,
  )
  uniforms.hmBendRotation.value = THREE.MathUtils.degToRad(
    bend?.bendRotation ?? 0,
  )
  uniforms.hmBendCaptureOrigin.value.set(
    bend?.captureOrigin.x ?? 0,
    bend?.captureOrigin.y ?? 0,
    bend?.captureOrigin.z ?? 0,
  )
  uniforms.hmBendCaptureLength.value = Math.max(0.0001, bend?.resolvedLength ?? 1)
}

const BEND_VERTEX_DECLARATIONS = `
uniform float hmBendEnabled;
uniform float hmBendAngle;
uniform float hmBendFactor;
uniform float hmBendBothDirections;
uniform float hmBendLimitToRegion;
uniform vec3 hmBendCaptureDirection;
uniform float hmBendCaptureRotation;
uniform vec3 hmBendUpDirection;
uniform float hmBendUpRotation;
uniform float hmBendRotation;
uniform vec3 hmBendCaptureOrigin;
uniform float hmBendCaptureLength;

vec3 hmSafeNormalize(vec3 value, vec3 fallbackValue) {
  float magnitude = length(value);
  return magnitude > 0.00001 ? value / magnitude : fallbackValue;
}

vec3 hmRotateAroundAxis(vec3 value, vec3 axisValue, float angle) {
  vec3 axis = hmSafeNormalize(axisValue, vec3(0.0, 0.0, 1.0));
  float cosine = cos(angle);
  float sine = sin(angle);
  return value * cosine + cross(axis, value) * sine +
    axis * dot(axis, value) * (1.0 - cosine);
}

vec2 hmBendArc(float q, float height, float start, float curvature) {
  float theta = curvature * q;
  float radius = 1.0 / curvature;
  return vec2(
    start + sin(theta) * (radius - height),
    (1.0 - cos(theta)) * radius + cos(theta) * height
  );
}

vec3 hmApplyBend(vec3 originalPoint) {
  if (
    hmBendEnabled < 0.5 ||
    abs(hmBendAngle) < 0.000001 ||
    hmBendFactor <= 0.0
  ) return originalPoint;

  vec3 localZ = vec3(0.0, 0.0, 1.0);
  vec3 capture = hmSafeNormalize(hmBendCaptureDirection, vec3(1.0, 0.0, 0.0));
  capture = hmRotateAroundAxis(capture, localZ, hmBendCaptureRotation);
  vec3 up = hmRotateAroundAxis(hmBendUpDirection, localZ, hmBendUpRotation);
  up -= capture * dot(up, capture);
  if (length(up) < 0.00001) {
    vec3 fallbackUp = abs(capture.z) < 0.9 ? localZ : vec3(0.0, 1.0, 0.0);
    up = fallbackUp - capture * dot(fallbackUp, capture);
  }
  up = hmSafeNormalize(up, vec3(0.0, 1.0, 0.0));
  vec3 across = hmSafeNormalize(cross(capture, up), localZ);
  up = hmSafeNormalize(cross(across, capture), up);

  vec3 relative = originalPoint - hmBendCaptureOrigin;
  float along = dot(relative, capture);
  float height = dot(relative, up);
  float acrossAmount = dot(relative, across);
  float captureLength = max(hmBendCaptureLength, 0.0001);
  float start = hmBendBothDirections > 0.5 ? -captureLength * 0.5 : 0.0;
  float q = along - start;
  float curvature = hmBendAngle / captureLength;
  vec2 bent;
  if (
    hmBendLimitToRegion < 0.5 ||
    (q >= 0.0 && q <= captureLength)
  ) {
    bent = hmBendArc(q, height, start, curvature);
  } else {
    float endpointQ = q < 0.0 ? 0.0 : captureLength;
    vec2 endpoint = hmBendArc(endpointQ, 0.0, start, curvature);
    float theta = curvature * endpointQ;
    vec2 tangent = vec2(cos(theta), sin(theta));
    vec2 normal = vec2(-sin(theta), cos(theta));
    float extension = q - endpointQ;
    bent = endpoint + tangent * extension + normal * height;
  }
  vec3 deformed = hmBendCaptureOrigin +
    capture * bent.x + up * bent.y + across * acrossAmount;
  if (abs(hmBendRotation) > 0.000001) {
    deformed = hmBendCaptureOrigin + hmRotateAroundAxis(
      deformed - hmBendCaptureOrigin,
      capture,
      hmBendRotation
    );
  }
  return mix(originalPoint, deformed, clamp(hmBendFactor, 0.0, 1.0));
}
`

function apertureKernelVectors(
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
  sampleCount: number,
): THREE.Vector2[] {
  const blades = clampInt(bladeCount, 3, 16)
  const rotation = Number(rotationDegrees.toFixed(3))
  const ratio = Number(clamp(bokehRatio, 0.25, 4).toFixed(3))
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const key = `${blades}:${rotation}:${ratio}:${count}`
  const cached = kernelCache.get(key)
  if (cached) return cached
  const vectors = createApertureKernel(
    count,
    blades,
    rotation,
    ratio,
  ).map(({ x, y }) => new THREE.Vector2(x, y))
  while (vectors.length < MAX_DOF_KERNEL_SAMPLES) {
    vectors.push(new THREE.Vector2())
  }
  kernelCache.set(key, vectors)
  return vectors
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}
