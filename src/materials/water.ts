// Water's own program (D-039, D-050): the env map and Fresnel from
// MeshStandardMaterial, a world-space ripple normal on the ambient-motion
// schedule (D-056, fol-ixw), and on mid and high tiers the mirrored neon
// pass (already blurred into vertical streaks), bent by the ripple.

import { Matrix4, type Texture } from 'three'
import type { AmbientConsumer } from '../time/ambient'
import type { Feature } from './composer'

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
    uRippleScale: { value: 0.9 },
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
        vec2 rippleBase = p * uRippleScale * vec2(0.6, 1.4);
        return waterNoise(rippleBase + vec2(0.32, 0.18) * t)
          + 0.5 * waterNoise(rippleBase * 2.3 + 7.1 - vec2(0.24, 0.36) * t);
      }`,
    chunks: {
      // Normal-only ripples were invisible from the town camera. A restrained
      // pool-teal value shift makes the same moving ridges visible without
      // introducing colors outside the shared material palette.
      color_fragment: {
        after: /* glsl */ `
          float rippleTint = smoothstep(0.72, 1.12, waterHeight(vWaterWorld.xz, uRippleTime));
          diffuseColor.rgb *= 0.84 + rippleTint * 0.24;`,
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
  const rippleBaseX = x * 0.9 * 0.6
  const rippleBaseZ = z * 0.9 * 1.4
  const height =
    noise(rippleBaseX + 0.32 * timeSeconds, rippleBaseZ + 0.18 * timeSeconds) +
    0.5 *
      noise(
        rippleBaseX * 2.3 + 7.1 - 0.24 * timeSeconds,
        rippleBaseZ * 2.3 + 7.1 - 0.36 * timeSeconds,
      )
  const t = Math.max(0, Math.min(1, (height - 0.72) / (1.12 - 0.72)))
  const ridge = t * t * (3 - 2 * t)
  return 0.84 + ridge * 0.24
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
