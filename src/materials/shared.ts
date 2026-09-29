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
import { type PaletteColors, palette } from '../palette'
import type { Look } from '../time/look'
import { composeDepthMaterial, composeMaterial, type Feature } from './composer'
import { bakedLight, foliage, group, groupLift, sway } from './features'
import { neonGlow } from './neonGlow'
import { water } from './water'

export interface SharedMaterial {
  material: Material
  depth: MeshDepthMaterial
  castShadow: boolean
}

function shared(
  material: Material,
  features: readonly Feature[],
  castShadow = true,
): SharedMaterial {
  return {
    material: composeMaterial(material, features),
    depth: composeDepthMaterial(features),
    castShadow,
  }
}

const lit = [bakedLight, group]
const neonColor = new Color(palette.mint)

/** Batch name → its shared material. The batch names are batchSchema's. */
export const materials: Readonly<Record<string, SharedMaterial>> = {
  cream: shared(new MeshStandardMaterial({ color: palette.cream, roughness: 0.3 }), lit),
  gold: shared(
    new MeshStandardMaterial({ color: palette.gold, metalness: 1, roughness: 0.28 }),
    lit,
  ),
  ground: shared(new MeshStandardMaterial({ color: palette.lawn, roughness: 0.95 }), lit),
  foliage: shared(
    new MeshStandardMaterial({ color: palette.leaf, roughness: 0.8, side: DoubleSide }),
    [...lit, foliage, sway],
  ),
  // Neon is its own unlit program (D-038) and casts no shadow (D-035).
  neon: shared(new MeshBasicMaterial({ color: neonColor.clone() }), [groupLift], false),
  neonGlow: shared(
    new MeshBasicMaterial({
      color: neonColor.clone(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    [groupLift, neonGlow],
    false,
  ),
  // Water's own program (D-039): still, glossy, and too flat to shade anything.
  water: shared(
    new MeshStandardMaterial({ color: palette.poolTeal, roughness: 0.06 }),
    [groupLift, water],
    false,
  ),
}

/** Batches drawn a second time from another batch's geometry: the glow shell is the neon's. */
export const derivedBatches: Readonly<Record<string, string>> = { neonGlow: 'neon' }

// With bloom, the shell only softens the tube's edge; without it, it is the glow.
const GLOW_WITH_BLOOM = 0.25

group.uniforms.uGroupGlowColor.value.set(palette.mint)
foliage.uniforms.uNewGrowth.value.set(palette.lawn)

/**
 * Moves every shared material to `look`. The base palette goes on first, so
 * the look-dev panel's draft recolors the scene live in one ordered pass
 * (D-034): base colors, then everything the look derives from them.
 */
export function applyLook(look: Look, bloom: boolean, pal: PaletteColors = palette): void {
  neonColor.set(pal.mint)
  group.uniforms.uGroupGlowColor.value.set(pal.mint)
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
  const neon = materials.neon?.material as MeshBasicMaterial
  neon.color.copy(neonColor).multiplyScalar(look.emissive)
  const glow = materials.neonGlow?.material as MeshBasicMaterial
  glow.color
    .copy(neonColor)
    .multiplyScalar(look.emissive * look.night * (bloom ? GLOW_WITH_BLOOM : 1))
}
