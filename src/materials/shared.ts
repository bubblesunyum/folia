// The shared materials (R-005): one per batch, created once, updated in place
// as the time of day moves. Everything is linear; palette hex is sRGB and
// three's color management converts it.

import {
  Color,
  DoubleSide,
  type Material,
  MeshBasicMaterial,
  type MeshDepthMaterial,
  MeshStandardMaterial,
} from 'three'
import { palette } from '../palette'
import type { Look } from '../time/look'
import { composeDepthMaterial, composeMaterial, type Feature } from './composer'
import { bakedLight, foliage, group, groupLift } from './features'

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
    [...lit, foliage],
  ),
  // Neon is its own unlit program (D-038) and casts no shadow (D-035).
  neon: shared(new MeshBasicMaterial({ color: neonColor.clone() }), [groupLift], false),
}

group.uniforms.uGroupGlowColor.value.set(palette.mint)

/** Moves every shared material to `look`. */
export function applyLook(look: Look): void {
  bakedLight.uniforms.uNightSpill.value = look.night
  const neon = materials.neon?.material as MeshBasicMaterial
  neon.color.copy(neonColor).multiplyScalar(look.emissive)
}
