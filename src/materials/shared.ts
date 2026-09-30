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
import { neonGlow } from './neonGlow'
import { water } from './water'

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
  return {
    material: composeMaterial(material, features),
    depth: composeDepthMaterial(features),
    castShadow,
    features,
  }
}

const lit = [bakedLight, group, reveal]
// The town-wide default signature until wave 2 threads the current hood.
const DEFAULT_HOOD = 'cortico'
const neonColor = new Color(signatureColor(DEFAULT_HOOD))

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
  neon: shared(
    new MeshBasicMaterial({ color: neonColor.clone() }),
    [groupLift, revealBasic],
    false,
  ),
  neonGlow: shared(
    new MeshBasicMaterial({
      color: neonColor.clone(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    [groupLift, neonGlow, revealBasic],
    false,
  ),
  // Water's own program (D-039): still, glossy, and too flat to shade anything.
  water: shared(
    new MeshStandardMaterial({ color: palette.poolTeal, roughness: 0.06 }),
    [groupLift, water, reveal],
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
 * (D-034): base colors, then everything the look derives from them.
 */
export function applyLook(look: Look, bloom: boolean, pal: PaletteColors = palette): void {
  neonColor.set(signatureColor(DEFAULT_HOOD, pal))
  group.uniforms.uGroupGlowColor.value.set(signatureColor(DEFAULT_HOOD, pal))
  group.uniforms.uGroupTintColor.value.set(signatureColor(DEFAULT_HOOD, pal))
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
  const neon = materials.neon?.material as MeshBasicMaterial
  neon.color.copy(neonColor).multiplyScalar(look.emissive)
  const glow = materials.neonGlow?.material as MeshBasicMaterial
  glow.color
    .copy(neonColor)
    .multiplyScalar(look.emissive * look.night * (bloom ? GLOW_WITH_BLOOM : 1))
}
