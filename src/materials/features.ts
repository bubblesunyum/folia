// The composer's features for the shared materials. Each one reads the
// attributes the Blender pipeline bakes (D-031, D-032), renamed at load by
// assets/batches.ts, and exposes its knobs as shared uniforms.

import { Color, Vector4 } from 'three'
import { MAX_GROUPS } from '../groupSlots'
import type { Feature } from './composer'

/**
 * Baked AO and night spill (D-031). `_AO` stands in for three's aoMap: it
 * darkens indirect diffuse and drives specular occlusion, never direct sun.
 * `_NIGHT` is emission-only irradiance from the neon, added to indirect
 * diffuse and scaled by the time of day.
 */
export const bakedLight = {
  key: 'baked',
  uniforms: {
    uAoIntensity: { value: 1 },
    uNightSpill: { value: 0 },
  },
  vertex: {
    header: /* glsl */ `
      attribute float bakedAo;
      attribute vec3 bakedNight;
      varying float vBakedAo;
      varying vec3 vBakedNight;`,
    chunks: {
      begin_vertex: { after: 'vBakedAo = bakedAo;\nvBakedNight = bakedNight;' },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform float uAoIntensity;
      uniform float uNightSpill;
      varying float vBakedAo;
      varying vec3 vBakedNight;`,
    chunks: {
      // After lights_fragment_end, where three applies its own aoMap.
      aomap_fragment: {
        instead: /* glsl */ `
          float ambientOcclusion = (vBakedAo - 1.0) * uAoIntensity + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined(USE_ENVMAP) && defined(STANDARD)
            float dotNV = saturate(dot(geometryNormal, geometryViewDir));
            reflectedLight.indirectSpecular *=
              computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
          #endif
          reflectedLight.indirectDiffuse += material.diffuseContribution * vBakedNight * uNightSpill;`,
      },
    },
  },
} satisfies Feature

/**
 * Per-group state (D-032): `uGroupState[_ID]` is (lift in metres, glow, 0, 0).
 * A hover is one uniform write. Lift moves the shadow too, so it's also in
 * the depth material.
 */
const groupVertex = {
  header: /* glsl */ `
    attribute float groupId;
    uniform vec4 uGroupState[${MAX_GROUPS}];
    varying float vGroupGlow;`,
  chunks: {
    begin_vertex: {
      after: /* glsl */ `
        vec4 groupState = uGroupState[int(groupId + 0.5)];
        transformed.y += groupState.x;
        vGroupGlow = groupState.y;`,
    },
  },
}

export const group = {
  key: 'group',
  uniforms: {
    uGroupState: { value: Array.from({ length: MAX_GROUPS }, () => new Vector4()) },
    uGroupGlowColor: { value: new Color() },
  },
  vertex: groupVertex,
  fragment: {
    header: 'uniform vec3 uGroupGlowColor;\nvarying float vGroupGlow;',
    chunks: {
      emissivemap_fragment: { after: 'totalEmissiveRadiance += uGroupGlowColor * vGroupGlow;' },
    },
  },
  depthVertex: groupVertex,
} satisfies Feature

/**
 * Foliage (D-045): leaves are single-sided cards drawn DoubleSide, shaded by
 * their clump's proxy normals, so the back face keeps the front's normal
 * rather than flipping. Adds wrap lighting and a back-lit translucency term
 * from the sun, and a value jitter so clumps don't read as one flat green.
 * The translucency ignores the sun's shadow for now.
 */
export const foliage = {
  key: 'foliage',
  uniforms: {
    uWrap: { value: 0.5 },
    uTranslucency: { value: 0.9 },
    uTranslucencyPower: { value: 3 },
    uJitter: { value: 0.18 },
    uNewGrowth: { value: new Color() },
    uGrowth: { value: 0.45 },
  },
  vertex: {
    header: 'varying vec3 vFoliageWorld;',
    chunks: {
      worldpos_vertex: {
        after: /* glsl */ `
          #ifdef USE_BATCHING
            vFoliageWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vFoliageWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`,
      },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform float uWrap;
      uniform float uTranslucency;
      uniform float uTranslucencyPower;
      uniform float uJitter;
      uniform vec3 uNewGrowth;
      uniform float uGrowth;
      varying vec3 vFoliageWorld;
      float foliageHash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      // Value noise, smoothly interpolated, so colour drifts across a clump
      // instead of switching at axis-aligned cell walls.
      float foliageNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        vec2 k = vec2(0.0, 1.0);
        return mix(
          mix(mix(foliageHash(i + k.xxx), foliageHash(i + k.yxx), f.x),
              mix(foliageHash(i + k.xyx), foliageHash(i + k.yyx), f.x), f.y),
          mix(mix(foliageHash(i + k.xxy), foliageHash(i + k.yxy), f.x),
              mix(foliageHash(i + k.xyy), foliageHash(i + k.yyy), f.x), f.y),
          f.z);
      }`,
    chunks: {
      color_fragment: {
        after: /* glsl */ `
          // Lobe-scale value drift, and clump-scale patches of yellower new growth.
          float jitter = foliageNoise(vFoliageWorld * 2.5);
          float growth = smoothstep(0.45, 0.85, foliageNoise(vFoliageWorld * 0.7 + 17.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, uNewGrowth, uGrowth * growth);
          diffuseColor.rgb *= 1.0 + uJitter * (jitter - 0.5) * 2.0;`,
      },
      normal_fragment_begin: {
        after: /* glsl */ `
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif`,
      },
      lights_fragment_end: {
        after: /* glsl */ `
          #if NUM_DIR_LIGHTS > 0
            vec3 sunDir = directionalLights[0].direction;
            vec3 sunColor = directionalLights[0].color;
            float ndl = dot(normal, sunDir);
            float wrapped = saturate((ndl + uWrap) / (1.0 + uWrap)) - saturate(ndl);
            float backLit = pow(saturate(dot(-geometryViewDir, sunDir)), uTranslucencyPower);
            float thin = 1.0 - 0.6 * saturate(ndl);
            // On Lambert's scale (1/π), so wrap tops out below a sun-facing leaf.
            reflectedLight.directDiffuse += sunColor * material.diffuseContribution * RECIPROCAL_PI
              * (wrapped + uTranslucency * backLit * thin);
          #endif`,
      },
    },
  },
} satisfies Feature

/** The group lift alone, for programs with no emissive term (neon). */
export const groupLift = {
  key: 'group-lift',
  uniforms: { uGroupState: group.uniforms.uGroupState },
  vertex: groupVertex,
  depthVertex: groupVertex,
} satisfies Feature

/**
 * Sway (spike 5, D-041): a procedural breeze over foliage, driven by `Sway`'s
 * clock. The phase rides on the batch/instance-space anchor — the vertex
 * carried through the batch then instance matrices — so instances sharing one
 * geometry never sway in lockstep; under today's identity batching the anchor
 * is `position`, exactly the old phase. Amplitude is height-weighted on the
 * geometry-local Y (see `swayModel.ts`): trunks hold still, tops take the full
 * breeze. It moves the shadow too, so it's also in the depth material —
 * freezing shadows while sway runs detaches them (D-041's static fallback).
 */
const swayVertex = {
  header: /* glsl */ `
    uniform float uSwayTime;
    uniform float uSwayStrength;`,
  chunks: {
    begin_vertex: {
      after: /* glsl */ `
        vec3 swayAnchor = position;
        #ifdef USE_BATCHING
          swayAnchor = (batchingMatrix * vec4(swayAnchor, 1.0)).xyz;
        #endif
        #ifdef USE_INSTANCING
          swayAnchor = (instanceMatrix * vec4(swayAnchor, 1.0)).xyz;
        #endif
        float swayWeight = smoothstep(0.5, 2.5, position.y);
        float swayPhase = uSwayTime * 1.6 + swayAnchor.x * 0.35 + swayAnchor.z * 0.45;
        transformed.x += sin(swayPhase) * uSwayStrength * swayWeight;
        transformed.z += cos(swayPhase * 0.83) * uSwayStrength * 0.6 * swayWeight;`,
    },
  },
}

export const sway = {
  key: 'sway',
  uniforms: {
    uSwayTime: { value: 0 },
    // Zero until `Sway` mounts and claims it: the feature is composed
    // unconditionally, so a nonzero default would freeze a warped pose into
    // every still render with the clock stopped.
    uSwayStrength: { value: 0 },
  },
  vertex: swayVertex,
  depthVertex: swayVertex,
} satisfies Feature

/** Peak sway in metres, claimed by `Sway` while it drives the clock. */
export const SWAY_STRENGTH = 0.05
