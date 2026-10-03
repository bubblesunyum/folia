// Authored light-pool placement (fol-kes.4): the checked-in
// fragment-layout.json is the owning source, so this spec pins every pool to
// a walkable terrace top — the right level's height (never the canopy roof),
// inside that level's baked outline (never lawn), clear of the trunk, petals,
// pond and forum footprints, and separated from every other pool. Any params
// edit without a re-bake fails here instead of shipping stale spots.

import { describe, expect, it } from 'vitest'
import forumParams from '../../assets/blender/cortico/forum.json' with { type: 'json' }
import forumLayout from '../../assets/blender/cortico/forum-layout.json' with { type: 'json' }
import fragmentParams from '../../assets/blender/cortico/fragment.json' with { type: 'json' }
import fragmentLayout from '../../assets/blender/cortico/fragment-layout.json' with { type: 'json' }
import {
  POOL_LIFT_M,
  POOL_RADIUS_M,
  POOL_SPACING_M,
  parseLightPoolLayout,
} from '../materials/lightPool'

type Outline = readonly (readonly [number, number])[]

function pointInOutline(x: number, z: number, outline: Outline): boolean {
  let inside = false
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    if (!a || !b) continue
    if (a[1] > z !== b[1] > z && x < a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) {
      inside = !inside
    }
  }
  return inside
}

function distToOutline(x: number, z: number, outline: Outline): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    if (!a || !b) continue
    const abx = b[0] - a[0]
    const abz = b[1] - a[1]
    const denom = abx * abx + abz * abz
    const t = denom === 0 ? 0 : ((x - a[0]) * abx + (z - a[1]) * abz) / denom
    const c = Math.max(0, Math.min(1, t))
    best = Math.min(best, Math.hypot(x - (a[0] + abx * c), z - (a[1] + abz * c)))
  }
  return best
}

const layout = fragmentLayout as unknown as {
  source: {
    seed: number
    harmonics: number[]
    levels: { centre: [number, number]; radius: number; top: number }[]
    pools: { radius: number; lift: number; spacing: number }
    exclusions: Record<
      'trunk' | 'shell' | 'pond' | 'forum',
      { at: [number, number]; r: number }
    > & {
      clearance: number
    }
    edgeMargin: number
  }
  outlines: Outline[]
  pools: { x: number; y: number; z: number; r: number; level: number }[]
}

describe('light-pool layout source (fol-kes.4)', () => {
  it('echoes the fragment params, so a params edit without a re-bake fails', () => {
    expect(layout.source.seed).toBe(fragmentParams.seed)
    expect(layout.source.harmonics).toEqual(fragmentParams.terraces.harmonics)
    expect(layout.source.levels).toEqual(
      fragmentParams.terraces.levels.map(
        (level: { centre: number[]; radius: number; top: number }) => ({
          centre: level.centre,
          radius: level.radius,
          top: level.top,
        }),
      ),
    )
  })

  it('echoes the pool params, so a params edit without a re-bake fails', () => {
    expect(layout.source.pools).toEqual(fragmentParams.pools)
  })

  it('shares one params object with the TS constants', () => {
    const pools = fragmentParams.pools as { radius: number; lift: number; spacing: number }
    expect(POOL_RADIUS_M).toBe(pools.radius)
    expect(POOL_LIFT_M).toBe(pools.lift)
    expect(POOL_SPACING_M).toBe(pools.spacing)
    expect(layout.source.pools.radius).toBe(POOL_RADIUS_M)
    expect(layout.source.pools.spacing).toBe(POOL_SPACING_M)
  })

  it('echoes the exclusion footprints from the asset params', () => {
    const { exclusions } = layout.source
    const clearance = exclusions.clearance
    expect(clearance).toBe(POOL_RADIUS_M)
    expect(exclusions.trunk?.at).toEqual(fragmentParams.canopy.position)
    expect(exclusions.trunk?.r).toBe(fragmentParams.canopy.trunk.r_base)
    expect(exclusions.shell?.at).toEqual(fragmentParams.shell.position)
    expect(exclusions.shell?.r).toBe(
      Math.max(...fragmentParams.shell.rings.map((ring: { length: number }) => ring.length)),
    )
    const water = fragmentParams.water
    expect(exclusions.pond?.at).toEqual(water.centre)
    expect(exclusions.pond?.r).toBeCloseTo(
      water.radius * (1 + water.harmonics.reduce((a: number, b: number) => a + b, 0)) +
        water.rim.radius,
      3,
    )
    expect(exclusions.forum?.at).toEqual(forumLayout.centre)
    expect(exclusions.forum?.r).toBe(forumParams.medallion.radius)
  })

  it('parses through the component path', () => {
    expect(parseLightPoolLayout(fragmentLayout)).toHaveLength(layout.pools.length)
  })
})

describe('light-pool placement (fol-kes.4)', () => {
  it('lands pools only on terrace walk surfaces', () => {
    expect(layout.source.edgeMargin).toBeGreaterThanOrEqual(POOL_RADIUS_M)
    expect(layout.pools.length).toBeGreaterThan(0)
    for (const pool of layout.pools) {
      expect(pool.r).toBe(POOL_RADIUS_M)
      const level = layout.source.levels[pool.level]
      expect(level).toBeDefined()
      // The terrace top under the pool, never the canopy roof or the lawn.
      expect(pool.y).toBeCloseTo((level?.top ?? 0) + POOL_LIFT_M, 2)
      const outline = layout.outlines[pool.level]
      expect(outline).toBeDefined()
      // The whole visible disc, not just the centre: every footprint point
      // stays on the walk surface (layout rounds to the millimetre, so test
      // a hair inside the authored radius).
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2
        const px = pool.x + Math.cos(angle) * (POOL_RADIUS_M - 0.005)
        const pz = pool.z + Math.sin(angle) * (POOL_RADIUS_M - 0.005)
        expect(pointInOutline(px, pz, outline ?? [])).toBe(true)
      }
      // The highest top under the pool: no higher terrace claims its centre.
      for (let above = pool.level + 1; above < layout.outlines.length; above++) {
        const higher = layout.outlines[above]
        expect(pointInOutline(pool.x, pool.z, higher ?? [])).toBe(false)
      }
      // Inside the lip by the bake's edge margin (likewise, a hair under).
      expect(distToOutline(pool.x, pool.z, outline ?? [])).toBeGreaterThan(
        layout.source.edgeMargin - 0.005,
      )
    }
  })

  it('keeps every exclusion footprint plus one pool radius clear', () => {
    const { exclusions } = layout.source
    const clearance = exclusions.clearance
    for (const pool of layout.pools) {
      for (const name of ['trunk', 'shell', 'pond', 'forum'] as const) {
        const zone = exclusions[name]
        expect(zone).toBeDefined()
        const [cx, cz] = zone.at
        expect(Math.hypot(pool.x - cx, pool.z - cz)).toBeGreaterThanOrEqual(zone.r + clearance)
      }
    }
  })

  it('separates pools so the additive quads never double-brighten', () => {
    for (let i = 0; i < layout.pools.length; i++) {
      for (let j = i + 1; j < layout.pools.length; j++) {
        const a = layout.pools[i]
        const b = layout.pools[j]
        if (!a || !b) continue
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(POOL_SPACING_M - 0.01)
      }
    }
  })
})
