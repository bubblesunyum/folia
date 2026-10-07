// Moon rim on the lit batches (fol-2mq, fol-snu.5): a fresnel edge light in
// moonlight, so the voronoi canopy and the lotus read rimmed instead of unlit
// black silhouettes at night. It composes through the shared `lit` set, so
// lawn and foliage rim with the architecture — the moon lights the world, not
// just the hero forms. Weighted by the look's moon strength, which is exactly
// zero by day, so daylight pixels are unchanged. Uniforms default inert (black
// / 0): the feature composes unconditionally, so a nonzero default would tint
// still renders with the look unapplied.

import { Color } from 'three'
import type { Feature } from './composer'

/** Fresnel power shaping the rim toward grazing edges. */
export const MOON_RIM_POWER = 2.5

/** Emissive scale at full moon strength; keeps edges lit, never neon-bright. */
export const MOON_RIM_SCALE = 0.6

/**
 * Pure mirror of the shader below (foliage precedent): the rim response for a
 * view-ray/normal alignment `ndv` at moon `strength`. Pinned in vitest instead
 * of pixels.
 */
export function moonRimResponse(ndv: number, strength: number): number {
  const facing = Math.min(Math.max(ndv, 0), 1)
  return strength * (1 - facing) ** MOON_RIM_POWER * MOON_RIM_SCALE
}

export const moonRim = {
  key: 'moon-rim',
  uniforms: {
    // Moonlight color, written by `applyLook` from the look. Black until
    // claimed, for the same reason as the foliage spill color.
    uMoonRimColor: { value: new Color(0, 0, 0) },
    // The look's moon strength; zero by day and until `applyLook` claims it.
    uMoonRimStrength: { value: 0 },
  },
  fragment: {
    header: /* glsl */ `
      uniform vec3 uMoonRimColor;
      uniform float uMoonRimStrength;`,
    chunks: {
      // `normal` and `geometryViewDir` are declared by three's
      // normal_fragment_begin and stay in scope through the lights terms
      // (the foliage precedent); the emissive accumulator is still open.
      lights_fragment_end: {
        after: /* glsl */ `
          float rimNdv = saturate(dot(normalize(normal), normalize(geometryViewDir)));
          totalEmissiveRadiance += uMoonRimColor
            * (uMoonRimStrength * pow(1.0 - rimNdv, ${MOON_RIM_POWER.toFixed(1)}) * ${MOON_RIM_SCALE.toFixed(1)});`,
      },
    },
  },
} satisfies Feature
