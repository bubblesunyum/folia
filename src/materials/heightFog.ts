// Exponential height + distance fog (D-046): the height half of the look's
// fog, injected through the composer so both controls affect visible pixels.
// Density at height y is `density * exp(-falloff * (y - baseHeight))`,
// integrated analytically along the eye-to-fragment ray; at zero falloff it
// recovers pure exponential distance fog. The world position is the shared
// `worldPosition` feature's varying (fol-kes.7) — this feature declares
// nothing and requires it — so sway and group lift stay coherent through the
// one batch/instance path instead of a second copy.
//
// The mix lands on `outgoingLight` before `opaque_fragment`: three runs its
// own fog after tonemapping + output conversion, but the composer terms live
// in linear working space, so fog must too. The stock `fog_fragment` chunk is
// replaced with nothing, so the distance term can never double-apply. The fog
// color is the shared sky gradient sampled in the eye-to-fragment direction
// (D-046), not a flat uniform. Color-only: no depth stage, so shadows and
// silhouettes are untouched. Density defaults to 0 (exactly unchanged until
// `applyLook` claims it), and the key carries no values, so time scrubbing
// never recompiles.

import type { Feature } from './composer'
import { SKY_GRADIENT_GLSL, skyGradientUniforms } from './skyGradient'

/**
 * Pure mirror of the shader below (the foliage precedent): the fog factor for
 * an eye-to-fragment distance `dist`, eye height above the fog base
 * `eyeAbove`, fragment-minus-eye height `dy`, and the look's fog params.
 * Pinned in vitest instead of pixels, including the near-horizontal branch.
 */
export function heightFogFactor(
  dist: number,
  eyeAbove: number,
  dy: number,
  density: number,
  falloff: number,
): number {
  const falloffDy = falloff * dy
  const heightWeight = Math.exp(-falloff * eyeAbove)
  // Closed form of the height average along the ray; the series keeps
  // near-horizontal rays (|falloff * dy| -> 0) stable and continuous.
  const avg =
    Math.abs(falloffDy) < 1e-3 ? 1 - 0.5 * falloffDy : (1 - Math.exp(-falloffDy)) / falloffDy
  return 1 - Math.exp(-density * dist * heightWeight * avg)
}

const fogUniforms = {
  uFogDensity: { value: 0 },
  uFogHeightFalloff: { value: 0 },
  uFogBaseHeight: { value: 0 },
}

const fogFactorGLSL = /* glsl */ `
  float heightFogFactor(float dist, float eyeAbove, float dy, float density, float falloff) {
    float falloffDy = falloff * dy;
    float heightWeight = exp(-falloff * eyeAbove);
    float avg = abs(falloffDy) < 0.001
      ? 1.0 - 0.5 * falloffDy
      : (1.0 - exp(-falloffDy)) / falloffDy;
    return 1.0 - exp(-density * dist * heightWeight * avg);
  }
  float heightFogAmount(vec3 fogWorld) {
    float fogDist = length(fogWorld - cameraPosition);
    return heightFogFactor(
      fogDist, cameraPosition.y - uFogBaseHeight, fogWorld.y - cameraPosition.y,
      uFogDensity, uFogHeightFalloff);
  }`

const fogDensityHeader = /* glsl */ `
  uniform float uFogDensity;
  uniform float uFogHeightFalloff;
  uniform float uFogBaseHeight;
  // vSharedWorld is declared by the worldPosition feature's header: fog
  // always composes after it, so the declaration precedes this use.`

export const heightFog = {
  key: 'height-fog',
  requires: ['world-position'],
  uniforms: { ...fogUniforms, ...skyGradientUniforms },
  fragment: {
    header: fogDensityHeader + SKY_GRADIENT_GLSL + fogFactorGLSL,
    chunks: {
      // Linear working space: outgoingLight has seen neither tonemapping nor
      // output conversion yet, exactly like the sky-gradient uniforms.
      opaque_fragment: {
        before: /* glsl */ `
          vec3 fogRay = vSharedWorld - cameraPosition;
          float fogAmt = heightFogAmount(vSharedWorld);
          // Zero-length ray sits exactly on the eye: the factor is 0 there,
          // so the guarded direction never tints a pixel.
          outgoingLight = mix(
            outgoingLight, skyGradientColor(fogRay / max(length(fogRay), 1e-4)), fogAmt);`,
      },
      // The stock distance fog must not run as well: replaced with nothing.
      fog_fragment: { instead: '' },
    },
  },
} satisfies Feature

/**
 * The height fog for additive shells (neonGlow, D-046): the shell adds light
 * over an already-fogged tube, so mixing it toward the sky color would stack
 * fog twice. Instead the shell's own contribution attenuates toward black —
 * distant glow fades out rather than fogging over. Shares the density
 * uniform objects with `heightFog` (one `applyLook` write drives both; no
 * per-material mutation) and needs no sky uniforms. Never composed with
 * `heightFog` in one program: both declare `heightFogFactor`.
 */
export const heightFogAdditive = {
  key: 'height-fog-additive',
  requires: ['world-position'],
  uniforms: fogUniforms,
  fragment: {
    header: fogDensityHeader + fogFactorGLSL,
    chunks: {
      opaque_fragment: {
        before: 'outgoingLight *= 1.0 - heightFogAmount(vSharedWorld);',
      },
      fog_fragment: { instead: '' },
    },
  },
} satisfies Feature
