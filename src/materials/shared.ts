// The shared materials (R-005): one per batch, created once, updated in place
// as the time of day moves. Everything is linear; palette hex is sRGB and
// three's color management converts it.

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  type Material,
  MeshBasicMaterial,
  type MeshDepthMaterial,
  MeshStandardMaterial,
} from 'three'
import { type PaletteColors, palette, signatureColor } from '../palette'
import type { Look } from '../time/look'
import { composeDepthMaterial, composeMaterial, type Feature } from './composer'
import { bakedLight, foliage, group, groupLift, reveal, revealBasic, sway } from './features'
import { heightFog, heightFogAdditive } from './heightFog'
import { lightPoolUniforms } from './lightPool'
import { moonRim } from './moonRim'
import { neonGlow } from './neonGlow'
import { applySkyGradient } from './skyGradient'
import { water } from './water'
import { windowBands } from './windowBands'

export interface SharedMaterial {
  material: Material
  depth: MeshDepthMaterial
  castShadow: boolean
  /** The composed features, so tests can pin each program's coverage. */
  features: readonly Feature[]
}

function shared(
  material: Material,
  features: readonly Feature[],
  castShadow = true,
): SharedMaterial {
  // Built-in fog stays off: the composer's height-fog feature owns fog (D-046)
  // and replaces the stock chunk, so the distance term can never double-apply.
  // (`fog: false` rides each constructor below; the base type omits the flag.)
  return {
    material: composeMaterial(material, features),
    depth: composeDepthMaterial(features),
    castShadow,
    features,
  }
}

const lit = [bakedLight, group, reveal, moonRim, heightFog]
// Facades (fol-snu.3): the lit set plus the warm window bands. Ground stays
// on `lit`: terrain gets no windows.
const facadeLit = [...lit, windowBands]
// The town-wide default signature until wave 2 threads the current hood.
const DEFAULT_HOOD = 'cortico'
const neonColor = new Color(signatureColor(DEFAULT_HOOD))

/** Batch name → its shared material. The batch names are batchSchema's. */
export const materials: Readonly<Record<string, SharedMaterial>> = {
  cream: shared(
    new MeshStandardMaterial({ color: palette.cream, roughness: 0.3, fog: false }),
    facadeLit,
  ),
  gold: shared(
    new MeshStandardMaterial({ color: palette.gold, metalness: 1, roughness: 0.28, fog: false }),
    facadeLit,
  ),
  ground: shared(
    new MeshStandardMaterial({ color: palette.lawn, roughness: 0.95, fog: false }),
    lit,
  ),
  foliage: shared(
    new MeshStandardMaterial({ color: palette.leaf, roughness: 0.8, side: DoubleSide, fog: false }),
    [...lit, foliage, sway],
  ),
  // Neon is its own unlit program (D-038) and casts no shadow (D-035).
  neon: shared(
    new MeshBasicMaterial({ color: neonColor.clone(), fog: false }),
    [groupLift, revealBasic, heightFog],
    false,
  ),
  neonGlow: shared(
    new MeshBasicMaterial({
      color: neonColor.clone(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    [groupLift, neonGlow, revealBasic, heightFogAdditive],
    false,
  ),
  // Water's own program (D-039): still, glossy, and too flat to shade anything.
  water: shared(
    new MeshStandardMaterial({ color: palette.poolTeal, roughness: 0.06, fog: false }),
    [groupLift, water, reveal, heightFog],
    false,
  ),
}

/** Batches drawn a second time from another batch's geometry: the glow shell is the neon's. */
export const derivedBatches: Readonly<Record<string, string>> = { neonGlow: 'neon' }

// With bloom, the shell only softens the tube's edge; without it, it is the glow.
const GLOW_WITH_BLOOM = 0.25

group.uniforms.uGroupGlowColor.value.set(signatureColor(DEFAULT_HOOD))
group.uniforms.uGroupTintColor.value.set(signatureColor(DEFAULT_HOOD))
reveal.uniforms.uRevealColor.value.set(palette.cream)
foliage.uniforms.uNewGrowth.value.set(palette.lawn)

/**
 * Moves every shared material to `look`. The base palette goes on first, so
 * the look-dev panel's draft recolors the scene live in one ordered pass
 * (D-034): base colors, then everything the look derives from them. `hood`
 * is the `:project` route's neighborhood: neon, hover glow and foliage
 * spill all read its signature color (D-024, fol-5co), failing closed on an
 * unmapped hood. The scene threads the route through; the default keeps
 * Cortico until it does. `sunDirection` is the live sun (see `MaterialLook`
 * and `SkyEnvironment`): the shared sky gradient owns the fog color, so the
 * same look + sun that paints the background recolors the fog — value writes
 * only, never a recompile. Omitted (tests) keeps the last sun and still
 * refreshes the sky colors and the shared density.
 */
export function applyLook(
  look: Look,
  bloom: boolean,
  pal: PaletteColors = palette,
  hood: string = DEFAULT_HOOD,
  sunDirection?: readonly number[],
): void {
  neonColor.set(signatureColor(hood, pal))
  group.uniforms.uGroupGlowColor.value.set(signatureColor(hood, pal))
  group.uniforms.uGroupTintColor.value.set(signatureColor(hood, pal))
  reveal.uniforms.uRevealColor.value.set(pal.cream)
  foliage.uniforms.uNewGrowth.value.set(pal.lawn)
  const bases: ReadonlyArray<readonly [string, string]> = [
    ['cream', pal.cream],
    ['gold', pal.gold],
    ['ground', pal.lawn],
    ['foliage', pal.leaf],
    ['water', pal.poolTeal],
  ]
  for (const [batch, hex] of bases) {
    ;(materials[batch]?.material as MeshStandardMaterial | undefined)?.color.set(hex)
  }
  bakedLight.uniforms.uNightSpill.value = look.night
  moonRim.uniforms.uMoonRimColor.value.fromArray(look.moon.color)
  moonRim.uniforms.uMoonRimStrength.value = look.moon.intensity
  windowBands.uniforms.uWindowNight.value = look.night
  windowBands.uniforms.uWindowColor.value.set(pal.sunGlow)
  lightPoolUniforms.uPoolNight.value = look.night
  lightPoolUniforms.uPoolColor.value.set(pal.tangerine)
  foliage.uniforms.uFoliageNight.value = look.night
  foliage.uniforms.uSpillColor.value.set(signatureColor(hood, pal))
  // Height + distance fog (D-046, fol-snu.4): shared uniform objects, so time
  // scrubbing mutates values in place and never recompiles a program. The
  // density trio is one shared trio: `heightFog` and `heightFogAdditive`
  // hold the same uniform objects, so one write drives ordinary and additive
  // shells together. The fog color is the shared sky gradient (same look +
  // sun as the background), not a flat uniform.
  heightFog.uniforms.uFogDensity.value = look.fog.density
  heightFog.uniforms.uFogHeightFalloff.value = look.fog.heightFalloff
  heightFog.uniforms.uFogBaseHeight.value = look.fog.baseHeight
  applySkyGradient(look, sunDirection)
  const neon = materials.neon?.material as MeshBasicMaterial
  neon.color.copy(neonColor).multiplyScalar(look.emissive)
  const glow = materials.neonGlow?.material as MeshBasicMaterial
  glow.color
    .copy(neonColor)
    .multiplyScalar(look.emissive * look.night * (bloom ? GLOW_WITH_BLOOM : 1))
}
