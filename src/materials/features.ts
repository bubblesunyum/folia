// The composer's features for the shared materials. Each one reads the
// attributes the Blender pipeline bakes (D-031, D-032), renamed at load by
// assets/batches.ts, and exposes its knobs as shared uniforms.

import { Color } from 'three'
import { MAX_GROUPS } from '../groupSlots'
import type { Feature } from './composer'
import { groupStateTexture } from './groupState'
import { REVEAL_BAND_M, REVEAL_GLOSS, REVEAL_PARKED_M } from './revealModel'

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
 * Per-group state (D-032's tiny-texture path): one RGBA float texel per slot
 * (lift in metres, glow, tint amount, reserved), written via
 * `materials/groupState.ts`. A hover is one texel write plus one upload, and
 * every material program samples the same texture object. Lift moves the
 * shadow too, so it's also in the depth material.
 */
const groupVertex = {
  header: /* glsl */ `
    attribute float groupId;
    uniform sampler2D uGroupState;
    varying float vGroupGlow;
    varying float vGroupTint;`,
  chunks: {
    begin_vertex: {
      after: /* glsl */ `
        vec4 groupState = texture2D(uGroupState, vec2((groupId + 0.5) / float(${MAX_GROUPS}), 0.5));
        transformed.y += groupState.x;
        vGroupGlow = groupState.y;
        vGroupTint = groupState.z;`,
    },
  },
}

export const group = {
  key: `group-tex-${MAX_GROUPS}`,
  uniforms: {
    uGroupState: { value: groupStateTexture },
    uGroupGlowColor: { value: new Color() },
    uGroupTintColor: { value: new Color() },
  },
  vertex: groupVertex,
  fragment: {
    header:
      'uniform vec3 uGroupGlowColor;\nuniform vec3 uGroupTintColor;\nvarying float vGroupGlow;\nvarying float vGroupTint;',
    chunks: {
      color_fragment: {
        after:
          'diffuseColor.rgb = mix(diffuseColor.rgb, uGroupTintColor, clamp(vGroupTint, 0.0, 1.0));',
      },
      emissivemap_fragment: { after: 'totalEmissiveRadiance += uGroupGlowColor * vGroupGlow;' },
    },
  },
  depthVertex: groupVertex,
} satisfies Feature

/**
 * Pure mirror of the foliage back-light curve (fol-rzn, fol-bv8): the shader
 * below interpolates FOLIAGE_THIN_FALLOFF, so the shape is pinned in vitest
 * instead of pixels. Inputs saturate exactly like the GLSL.
 */
export const FOLIAGE_THIN_FALLOFF = 0.45

/** View-ray-to-sun alignment shaped by the translucency power. */
export function foliageBacklit(viewSun: number, power: number): number {
  const s = Math.min(Math.max(viewSun, 0), 1)
  return s ** power
}

/** Thickness proxy: sun-facing leaves read thick, edges and backs read thin. */
export function foliageThin(ndl: number): number {
  return 1 - FOLIAGE_THIN_FALLOFF * Math.min(Math.max(ndl, 0), 1)
}

/**
 * Foliage (D-045): leaves are single-sided cards drawn DoubleSide, shaded by
 * their clump's proxy normals, so the back face keeps the front's normal
 * rather than flipping. Adds wrap lighting and a back-lit translucency term
 * from the sun, and a value jitter so clumps don't read as one flat green.
 * The translucency is gated by the sun's shadow attenuation (fol-rzn), so
 * shaded clumps stop glowing.
 */
export const foliage = {
  key: 'foliage',
  // vSharedWorld (the shared world-position varying) and vBakedNight (the
  // baked spill): both declaring features always compose before foliage, so
  // their declarations precede these uses.
  requires: ['world-position'],
  uniforms: {
    uWrap: { value: 0.5 },
    uTranslucency: { value: 1.2 },
    uTranslucencyPower: { value: 2 },
    uJitter: { value: 0.18 },
    uNewGrowth: { value: new Color() },
    uGrowth: { value: 0.45 },
    // Night spill weight (fol-2rl): driven by the look's night weight, so the
    // term is exactly zero by day. Zero until `applyLook` claims it: the
    // feature composes unconditionally, so a nonzero default would tint still
    // renders with the look unapplied.
    uFoliageNight: { value: 0 },
    // Neon tint for the spill (fol-2rl, fol-5co): the hood's signature color,
    // written by `applyLook`. Black until claimed, for the same reason.
    uSpillColor: { value: new Color(0, 0, 0) },
  },
  fragment: {
    header: /* glsl */ `
      uniform float uWrap;
      uniform float uTranslucency;
      uniform float uTranslucencyPower;
      uniform float uJitter;
      uniform vec3 uNewGrowth;
      uniform float uGrowth;
      uniform float uFoliageNight;
      uniform vec3 uSpillColor;
      // vSharedWorld is declared by the worldPosition feature's header (see
      // requires above).
      // vBakedNight is declared by the bakedLight feature's header: foliage
      // always composes after lit, so the declaration precedes this use.
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
          float jitter = foliageNoise(vSharedWorld * 2.5);
          float growth = smoothstep(0.45, 0.85, foliageNoise(vSharedWorld * 0.7 + 17.0));
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
            float thin = 1.0 - ${FOLIAGE_THIN_FALLOFF.toFixed(2)} * saturate(ndl);
            // The sun's shadow attenuation for light 0 (fol-rzn): shaded
            // clumps keep wrap but lose the back-light glow. This is the stock
            // shadow term, so intensity-0 tiers read 1.0 and render unchanged.
            float sunShadow = 1.0;
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
              if (receiveShadow) {
                sunShadow = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
              }
            #endif
            // On Lambert's scale (1/π), so wrap tops out below a sun-facing leaf.
            reflectedLight.directDiffuse += sunColor * material.diffuseContribution * RECIPROCAL_PI
              * (wrapped + sunShadow * uTranslucency * backLit * thin);
          #endif`,
      },
      emissivemap_fragment: {
        after: /* glsl */ `
          // Neon spill on dark leaves (fol-2rl): the _NIGHT bake is D-038's
          // neon-proximity field, but leaf albedo crushes the diffuse path,
          // so near-neon clumps ride emissive and read lit from every side.
          // Weighted by the night weight, so daylight is exactly unchanged.
          totalEmissiveRadiance += uSpillColor * dot(vBakedNight, vec3(0.3333)) * uFoliageNight;`,
      },
    },
  },
} satisfies Feature

/** The group lift alone, for programs with no emissive term (neon). */
export const groupLift = {
  key: `group-lift-tex-${MAX_GROUPS}`,
  uniforms: { uGroupState: group.uniforms.uGroupState },
  vertex: groupVertex,
  depthVertex: groupVertex,
} satisfies Feature

/**
 * The loading reveal (D-018, D-044): the town rises through the opaque cream
 * ocean, which hides what's below by depth, while a thin glossy cream band
 * just above `revealHeight` reads as liquid flowing off — a color and
 * roughness blend, never a `discard`. Parked below the town (see
 * `revealModel.ts`) the mix is exactly zero. It moves no vertices, so it has
 * no depth stage: the shadow already agrees with the mesh.
 */
const revealUniforms = {
  uRevealHeight: { value: REVEAL_PARKED_M },
  uRevealColor: { value: new Color() },
  uRevealBand: { value: REVEAL_BAND_M },
  uRevealGloss: { value: REVEAL_GLOSS },
}

const revealHeader = /* glsl */ `
  uniform float uRevealHeight;
  uniform vec3 uRevealColor;
  uniform float uRevealBand;
  uniform float uRevealGloss;
  // vSharedWorld is declared by the worldPosition feature's header: the
  // band reads world height, so instanced copies reveal at their own height.
  // Both reveal variants require it (see requires below).
  float revealMix(float y) {
    return 1.0 - smoothstep(uRevealHeight, uRevealHeight + uRevealBand, y);
  }`

const revealColorChunk = {
  color_fragment: {
    after: 'diffuseColor.rgb = mix(diffuseColor.rgb, uRevealColor, revealMix(vSharedWorld.y));',
  },
} as const

export const reveal = {
  key: 'reveal',
  requires: ['world-position'],
  uniforms: revealUniforms,
  fragment: {
    header: revealHeader,
    chunks: {
      ...revealColorChunk,
      roughnessmap_fragment: {
        after: 'roughnessFactor = mix(roughnessFactor, uRevealGloss, revealMix(vSharedWorld.y));',
      },
    },
  },
} satisfies Feature

/** The reveal's color band alone, for programs with no roughness term (neon).
 * Shares `reveal`'s uniform objects, so one `applyLook` write drives both. */
export const revealBasic = {
  key: 'reveal-basic',
  requires: ['world-position'],
  uniforms: revealUniforms,
  fragment: {
    header: revealHeader,
    chunks: { ...revealColorChunk },
  },
} satisfies Feature

/**
 * Sway (spike 5, D-041; fol-a83): a procedural breeze over foliage, driven by
 * `Sway`'s clock. The phase rides on the batch/instance-space anchor — the
 * vertex carried through the batch then instance matrices — so instances
 * sharing one geometry never sway in lockstep; under today's identity
 * batching the anchor is `position`, exactly the old phase. Amplitude is the
 * per-vertex `_SWAY` weight Blender bakes (height above the clump base,
 * smoothstepped 0.5→2.5 m; see `swayModel.ts`): trunks hold still, tops take
 * the full breeze. Batches are world-baked, so a world-height ramp here would
 * pin terrace foliage to its terrace and freeze everything under 0.5 m world
 * — the weight comes from the attribute, never `position.y`. A missing
 * attribute reads 0 in WebGL, so un-baked geometry holds still (inert
 * default). It moves the shadow too, so it's also in the depth material —
 * freezing shadows while sway runs detaches them (D-041's static fallback).
 */
const swayVertex = {
  header: /* glsl */ `
    uniform float uSwayTime;
    uniform float uSwayStrength;
    // Baked in Blender as _SWAY; GLTFLoader lowercases custom attributes
    // (see assets/batches.ts), and the loader path leaves it un-renamed,
    // so the shader reads it as _sway.
    attribute float _sway;`,
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
        float swayWeight = _sway;
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
