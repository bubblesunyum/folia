// Water's own program (D-039, D-050): the env map and Fresnel from
// MeshStandardMaterial, a world-space ripple normal on the ambient-motion
// schedule (D-056, fol-ixw), and on mid and high tiers the mirrored neon
// pass (already blurred into vertical streaks), bent by the ripple.

import { Matrix4, type Texture } from 'three'
import type { AmbientConsumer } from '../time/ambient'
import type { Feature } from './composer'

/** Base ripple scale (per metre); the `uRippleScale` uniform default. */
export const WATER_RIPPLE_SCALE = 0.9
/** Plan stretch of the ripple base: ripples run across the pool. */
export const WATER_STRETCH_X = 0.6
export const WATER_STRETCH_Y = 1.4
/** First-octave advection vector (opposite the second octave). */
export const WATER_ADVECT_AX = 0.32
export const WATER_ADVECT_AY = 0.18
/** Second-octave advection vector. */
export const WATER_ADVECT_BX = 0.24
export const WATER_ADVECT_BY = 0.36
/** Second-octave frequency multiplier and scalar offset. */
export const WATER_OCTAVE_SCALE = 2.3
export const WATER_OCTAVE_OFFSET = 7.1
/** Smoothstep edges mapping ripple height to the visible tint ridge. */
export const WATER_TINT_LO = 0.72
export const WATER_TINT_HI = 1.12
/** Tinted-teal gain: `BASE + ridge * GAIN`. */
export const WATER_TINT_BASE = 0.84
export const WATER_TINT_GAIN = 0.24

export const water = {
  key: 'water',
  uniforms: {
    uReflection: { value: null as Texture | null },
    uReflectionMatrix: { value: new Matrix4() },
    /** 1 while the mirrored pass runs; 0 without it (the low tier): env and Fresnel only. */
    uReflectionStrength: { value: 0 },
    /** How far the ripple bends the reflection, in reflection-texture uv. */
    uDistort: { value: 0.008 },
    /** The shared ambient shader time, in seconds; 0 parks the ripple still. */
    uRippleTime: { value: 0 },
    /** Ripple slope and scale (per metre). */
    uRipple: { value: 0.14 },
    uRippleScale: { value: WATER_RIPPLE_SCALE },
  },
  vertex: {
    header: /* glsl */ `
      uniform mat4 uReflectionMatrix;
      varying vec3 vWaterWorld;
      varying vec4 vReflectionUv;`,
    chunks: {
      worldpos_vertex: {
        after: /* glsl */ `
          #ifdef USE_BATCHING
            vWaterWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif
          vReflectionUv = uReflectionMatrix * vec4(vWaterWorld, 1.0);`,
      },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform sampler2D uReflection;
      uniform float uReflectionStrength;
      uniform float uDistort;
      uniform float uRipple;
      uniform float uRippleScale;
      uniform float uRippleTime;
      varying vec3 vWaterWorld;
      varying vec4 vReflectionUv;
      float waterHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float waterNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
                   mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // Two octaves, stretched along x so the ripples run across the pool,
      // advected in opposite directions by the ambient clock. The color
      // modulation below makes those moving ridges readable at this framing.
      float waterHeight(vec2 p, float t) {
        vec2 rippleBase = p * uRippleScale * vec2(${WATER_STRETCH_X.toFixed(1)}, ${WATER_STRETCH_Y.toFixed(1)});
        return waterNoise(rippleBase + vec2(${WATER_ADVECT_AX.toFixed(2)}, ${WATER_ADVECT_AY.toFixed(2)}) * t)
          + 0.5 * waterNoise(rippleBase * ${WATER_OCTAVE_SCALE.toFixed(1)} + ${WATER_OCTAVE_OFFSET.toFixed(1)} - vec2(${WATER_ADVECT_BX.toFixed(2)}, ${WATER_ADVECT_BY.toFixed(2)}) * t);
      }`,
    chunks: {
      // Normal-only ripples were invisible from the town camera. A restrained
      // pool-teal value shift makes the same moving ridges visible without
      // introducing colors outside the shared material palette.
      color_fragment: {
        after: /* glsl */ `
          float rippleTint = smoothstep(${WATER_TINT_LO.toFixed(2)}, ${WATER_TINT_HI.toFixed(2)}, waterHeight(vWaterWorld.xz, uRippleTime));
          diffuseColor.rgb *= ${WATER_TINT_BASE.toFixed(2)} + rippleTint * ${WATER_TINT_GAIN.toFixed(2)};`,
      },
      // The pool is flat and faces up, so the ripple replaces the normal outright.
      // Both chunks land in main() and this one runs first, so the emissive chunk
      // below reads its rippleWorld rather than recomputing the slope.
      normal_fragment_maps: {
        after: /* glsl */ `
          vec2 rippleAt = vWaterWorld.xz;
          float rippleH = waterHeight(rippleAt, uRippleTime);
          vec2 rippleSlope = vec2(
            waterHeight(rippleAt + vec2(0.05, 0.0), uRippleTime) - rippleH,
            waterHeight(rippleAt + vec2(0.0, 0.05), uRippleTime) - rippleH) / 0.05;
          vec3 rippleWorld = normalize(vec3(-rippleSlope.x * uRipple, 1.0, -rippleSlope.y * uRipple));
          normal = normalize((viewMatrix * vec4(rippleWorld, 0.0)).xyz);`,
      },
      emissivemap_fragment: {
        after: /* glsl */ `
          vec2 reflectionUv = vReflectionUv.xy / vReflectionUv.w
            + rippleWorld.xz * uDistort / max(uRipple, 1e-3);
          totalEmissiveRadiance += texture2D(uReflection, reflectionUv).rgb * uReflectionStrength;`,
      },
    },
  },
} satisfies Feature

/** The ambient consumer id the ripple registers under (D-056, fol-ixw). */
export const RIPPLE_CONSUMER_ID = 'ripple'

/**
 * The ripple as an ambient consumer (pure core; the rig lives in
 * `scene/AmbientMotion.tsx`): one scheduled clock owns `uRippleTime`,
 * independently of the reflection pass. Reading, hidden tabs and reduced
 * motion freeze that clock. Release parks the time back at 0.
 */
export function rippleConsumer(): AmbientConsumer {
  return {
    update: (timeSeconds: number) => {
      water.uniforms.uRippleTime.value = timeSeconds
    },
    release: () => {
      water.uniforms.uRippleTime.value = 0
    },
  }
}

/** CPU mirror of the water's moving tint, for regression checks on visible motion. */
export function waterTintAt(x: number, z: number, timeSeconds: number): number {
  const rippleBaseX = x * WATER_RIPPLE_SCALE * WATER_STRETCH_X
  const rippleBaseZ = z * WATER_RIPPLE_SCALE * WATER_STRETCH_Y
  const height =
    noise(
      rippleBaseX + WATER_ADVECT_AX * timeSeconds,
      rippleBaseZ + WATER_ADVECT_AY * timeSeconds,
    ) +
    0.5 *
      noise(
        rippleBaseX * WATER_OCTAVE_SCALE + WATER_OCTAVE_OFFSET - WATER_ADVECT_BX * timeSeconds,
        rippleBaseZ * WATER_OCTAVE_SCALE + WATER_OCTAVE_OFFSET - WATER_ADVECT_BY * timeSeconds,
      )
  const t = Math.max(0, Math.min(1, (height - WATER_TINT_LO) / (WATER_TINT_HI - WATER_TINT_LO)))
  const ridge = t * t * (3 - 2 * t)
  return WATER_TINT_BASE + ridge * WATER_TINT_GAIN
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx0 = x - ix
  const fy0 = y - iy
  const fx = fx0 * fx0 * (3 - 2 * fx0)
  const fy = fy0 * fy0 * (3 - 2 * fy0)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
}

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}
