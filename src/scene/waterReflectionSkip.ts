// The water reflection's skip predicate and registry-driven batch discovery
// (fol-4zo): pure core under `scene/WaterReflection.tsx`'s thin rig. The
// mirrored pass exists to bounce neon off the pond at night, and warm
// architecture masses off it by day (fol-snu.2); with `?reflection=off`, off
// screen, or when neither weight is up it buys nothing, so the rig sits those
// frames out (D-056) and the water falls back to env and Fresnel.

import { Box3, type Frustum } from 'three'

/** `look.night` at or under this: the neon bounce is invisible, skip the pass. */
export const NIGHT_REFLECTION_CUTOFF = 0.02

/** `sun.daylight` at or under this: the sun is down, skip the day pass. */
export const DAY_REFLECTION_CUTOFF = 0.02

export interface ReflectionSkipInput {
  /** The `?reflection=off` switch (D-039): false keeps env and Fresnel only. */
  enabled: boolean
  /** The current look's night weight. */
  night: number
  /** The current sun's daylight weight (1 through most of the day, 0 at night). */
  day: number
  /** At least one water batch discovered in the registry. */
  hasWater: boolean
  /** The ponds' world bounds touch the camera frustum. */
  pondInFrustum: boolean
}

/**
 * True when the mirrored pass should sit the frame out: neither the night
 * neon nor the day architecture would read. Everything unknown fails closed:
 * a NaN weight reads as down, so it skips.
 */
export function shouldSkipReflection(input: ReflectionSkipInput): boolean {
  if (!input.enabled) return true
  if (!(input.night > NIGHT_REFLECTION_CUTOFF) && !(input.day > DAY_REFLECTION_CUTOFF)) return true
  if (!input.hasWater) return true
  if (!input.pondInFrustum) return true
  return false
}

/** The least a batch needs for discovery: its material identity. */
export interface WaterBatchLike {
  readonly material: unknown
}

/** The material identities that decide each batch's role in the mirrored pass. */
export interface WaterBatchRoles {
  /** The shared water material; null when the registry has none (skip). */
  waterMaterial: unknown
  /** Drawn lit in the mirrored pass (neon). */
  emissiveMaterials: ReadonlySet<unknown>
  /** Left out of the mirrored pass entirely (water, the glow shell). */
  hiddenMaterials: ReadonlySet<unknown>
}

export interface DiscoveredWaterBatches<T> {
  /** Batches carrying the water program: the mirror plane, hidden while mirroring. */
  pool: T[]
  /** Batches drawn lit into the mirror. */
  emissive: T[]
  /** Batches left out of the mirror. */
  hidden: T[]
  /** Everything else opaque: drawn black, to occlude. */
  occluders: T[]
}

/**
 * Partitions the registry's batches by material identity, never by batch
 * name: a renamed batch, a second water batch on the same shared material, or
 * batches nested in groups all land by what they draw. Precedence is pool,
 * hidden, emissive, occluder; an unknown material occludes, and a null water
 * material discovers no pool, so the pass skips instead of crashing the frame.
 */
export function discoverWaterBatches<T extends WaterBatchLike>(
  batches: Iterable<T>,
  roles: WaterBatchRoles,
): DiscoveredWaterBatches<T> {
  const pool: T[] = []
  const emissive: T[] = []
  const hidden: T[] = []
  const occluders: T[] = []
  for (const batch of batches) {
    const role = classifyWaterBatch(batch.material, roles)
    if (role === 'pool') pool.push(batch)
    else if (role === 'hidden') hidden.push(batch)
    else if (role === 'emissive') emissive.push(batch)
    else occluders.push(batch)
  }
  return { pool, emissive, hidden, occluders }
}

/** One batch's role in the mirrored pass, by material identity. */
export type WaterBatchRole = 'pool' | 'hidden' | 'emissive' | 'occluder'

/**
 * A single batch's role, with no allocation: the per-frame rig classifies
 * each batch in place instead of partitioning the registry into arrays.
 * Precedence matches `discoverWaterBatches`.
 */
export function classifyWaterBatch(
  material: unknown | readonly unknown[],
  roles: WaterBatchRoles,
): WaterBatchRole {
  if (Array.isArray(material)) {
    if (roles.waterMaterial != null && material.includes(roles.waterMaterial)) return 'pool'
    for (const m of material) {
      if (roles.hiddenMaterials.has(m)) return 'hidden'
    }
    for (const m of material) {
      if (roles.emissiveMaterials.has(m)) return 'emissive'
    }
    return 'occluder'
  }
  if (roles.waterMaterial != null && material === roles.waterMaterial) return 'pool'
  if (roles.hiddenMaterials.has(material)) return 'hidden'
  if (roles.emissiveMaterials.has(material)) return 'emissive'
  return 'occluder'
}

/**
 * The union of the ponds' world-space bounds, or null when there is nothing
 * to mirror: the rig skips rather than mirrors a guess.
 */
export function unionPondBounds(boxes: readonly Box3[], out = new Box3()): Box3 | null {
  if (boxes.length === 0) return null
  out.makeEmpty()
  for (const box of boxes) out.union(box)
  return out
}

/** True when the ponds' bounds touch the camera frustum. */
export function pondTouchesFrustum(frustum: Frustum, bounds: Box3): boolean {
  return frustum.intersectsBox(bounds)
}
