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
      // advected in opposite directions by the ambient clock so the motion
      // reads as water rather than a sliding sheet. At t = 0 the offsets are
      // exactly zero, so still renders sit on the old pose.
      float waterHeight(vec2 p, float t) {
        vec2 rippleBase = p * uRippleScale * vec2(0.6, 1.4);
        return waterNoise(rippleBase + vec2(0.06, 0.035) * t)
          + 0.5 * waterNoise(rippleBase * 2.3 + 7.1 - vec2(0.045, 0.075) * t);
      }`,
    chunks: {
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
 * `scene/WaterReflection.tsx`): the shared clock owns `uRippleTime`, so the
 * ripple moves inside frames other drivers cause and rests with them — the
 * rig ticks but never invalidates for it, keeping idle-rest green. Release
 * parks the time back at 0, the still pose.
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
