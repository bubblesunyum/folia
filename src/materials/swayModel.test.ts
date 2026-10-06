// Sway's instancing contract (fol-esq): phase from the per-instance anchor,
// amplitude weighted by local height, and bit-identical rest output.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import foliageParams from '../../assets/blender/folia/foliage_params.json' with { type: 'json' }
import { SWAY_STRENGTH, sway } from './features'
import { materials } from './shared'
import {
  IDENTITY_BATCH,
  type Mat4Elements,
  SWAY_BASE_M,
  SWAY_TOP_M,
  swayAnchor,
  swayOffset,
  swayPhase,
  swayWeight,
  translationBatch,
} from './swayModel'
import type { Vec3 } from './vec'

/** 90° about Y, column-major: maps [x, y, z] to [z, y, -x]. */
const ROT_Y_90: Mat4Elements = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]

describe('swayWeight', () => {
  it('pins the trunk and frees the top', () => {
    expect(swayWeight(0)).toBe(0)
    expect(swayWeight(SWAY_BASE_M)).toBe(0)
    expect(swayWeight(SWAY_TOP_M)).toBe(1)
    expect(swayWeight(SWAY_TOP_M + 4)).toBe(1)
  })

  it('ramps monotonically between base and top', () => {
    const mid = swayWeight((SWAY_BASE_M + SWAY_TOP_M) / 2)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(swayWeight(1)).toBeLessThan(swayWeight(2))
  })
})

describe('swayAnchor', () => {
  it('is exactly the local position under identity batching (old phase preserved)', () => {
    const p: Vec3 = [4.25, 1.5, -2.75]
    expect(swayAnchor(p, IDENTITY_BATCH, null)).toEqual(p)
    expect(swayAnchor(p, null, null)).toEqual(p)
  })

  it('carries the per-instance origin, so shared geometry never locksteps', () => {
    const p: Vec3 = [1, 0.5, 2]
    const here = swayAnchor(p, translationBatch(0, 0, 0), null)
    const there = swayAnchor(p, translationBatch(3, 0, -5), null)
    expect(swayPhase(there[0], there[2], 10)).not.toBe(swayPhase(here[0], here[2], 10))
  })

  it('carries instance rotation too, and applies batch before instance', () => {
    const p: Vec3 = [1, 0.5, 2]
    const rotated = swayAnchor(p, null, ROT_Y_90)
    expect(rotated).toEqual([2, 0.5, -1])
    const both = swayAnchor(p, translationBatch(10, 0, 0), ROT_Y_90)
    // Batch first (translate), then the instance rotation.
    expect(both).toEqual([2, 0.5, -11])
  })
})

describe('swayOffset', () => {
  it('moves nothing while the strength is inert (still renders are untouched)', () => {
    const off = swayOffset(swayPhase(4.25, -2.75, 123.4), 0, swayWeight(9))
    expect(off.x).toBeCloseTo(0, 15)
    expect(off.z).toBeCloseTo(0, 15)
  })

  it('moves nothing at the trunk even while driven', () => {
    const off = swayOffset(1.2, 0.05, swayWeight(0))
    expect(off.x).toBeCloseTo(0, 15)
    expect(off.z).toBeCloseTo(0, 15)
  })

  it('matches the legacy unweighted motion at full height (canopy flutter preserved)', () => {
    const phase = swayPhase(4.25, -2.75, 7.5)
    const strength = 0.05
    const off = swayOffset(phase, strength, swayWeight(SWAY_TOP_M))
    expect(off).toEqual({
      x: Math.sin(phase) * strength,
      z: Math.cos(phase * 0.83) * strength * 0.6,
    })
  })
})

describe('sway bake curve pin (fol-6di)', () => {
  it('reads one source with the Blender bake: TS edges equal foliage.py', () => {
    // The retune point is foliage_params.json: swayModel.ts imports it, and
    // terraces.py threads it through clump(). Any numeric drift on any side
    // retunes the breeze everywhere, so this fails closed on it.
    expect(SWAY_BASE_M).toBe(foliageParams.sway_base_m)
    expect(SWAY_TOP_M).toBe(foliageParams.sway_top_m)
    const py = readFileSync(
      new URL('../../assets/blender/folia/foliage.py', import.meta.url),
      'utf8',
    )
    const base = py.match(/^SWAY_BASE_M\s*=\s*([0-9.]+)/m)?.[1]
    const top = py.match(/^SWAY_TOP_M\s*=\s*([0-9.]+)/m)?.[1]
    expect(base, 'foliage.py SWAY_BASE_M fallback literal').toBeDefined()
    expect(top, 'foliage.py SWAY_TOP_M fallback literal').toBeDefined()
    expect(SWAY_BASE_M).toBe(Number(base))
    expect(SWAY_TOP_M).toBe(Number(top))
  })

  it('threads the edges through clump() params, not module literals', () => {
    const foliage = readFileSync(
      new URL('../../assets/blender/folia/foliage.py', import.meta.url),
      'utf8',
    )
    expect(foliage).toContain('p.get("sway_base_m"')
    expect(foliage).toContain('p.get("sway_top_m"')
    const terraces = readFileSync(
      new URL('../../assets/blender/folia/terraces.py', import.meta.url),
      'utf8',
    )
    expect(terraces).toContain('foliage_params.json')
    expect(terraces).toContain('sway_base_m')
    expect(terraces).toContain('sway_top_m')
  })
})

describe('town sway contract (fol-l7d.9)', () => {
  it('rides the town foliage batch: dropping sway there stills every town tree', () => {
    expect(materials.foliage?.features ?? []).toContain(sway)
  })

  it('keeps small town growth gentle but nonzero (meadow ~0.4, trailers ~0.16)', () => {
    // Pinned curve values, not just monotonicity: retuning the ramp edges
    // re-decides town amplitude, so it must break loudly here.
    expect(swayWeight(1.0)).toBeCloseTo(0.15625, 10)
    expect(swayWeight(1.5)).toBe(0.5)
    const trailer = swayWeight(1.0)
    const meadow = swayWeight(1.34)
    expect(trailer).toBeGreaterThan(0)
    expect(trailer).toBeLessThan(meadow)
    expect(meadow).toBeGreaterThan(0.3)
    expect(meadow).toBeLessThan(0.5)
  })

  it('anchors town vertices on world position: batches are baked, instances identity', () => {
    const world: Vec3 = [12.5, 3.1, -7.25]
    expect(swayAnchor(world, IDENTITY_BATCH, null)).toEqual(world)
  })

  it('gives neighboring town clumps their own phase, deterministically', () => {
    const a = swayPhase(12.5, -7.25, 10)
    const b = swayPhase(17.5, -7.25, 10)
    expect(b).not.toBe(a)
    expect(swayPhase(12.5, -7.25, 10)).toBe(a)
  })

  it('bounds driven town motion by strength times weight', () => {
    for (const weight of [swayWeight(1.0), swayWeight(1.34), 1]) {
      for (const phase of [0, 1.2, 4.4]) {
        const off = swayOffset(phase, SWAY_STRENGTH, weight)
        expect(Math.abs(off.x)).toBeLessThanOrEqual(SWAY_STRENGTH * weight)
        expect(Math.abs(off.z)).toBeLessThanOrEqual(SWAY_STRENGTH * weight)
      }
    }
  })
})

describe('sway chunks', () => {
  it('derives phase from the batch/instance anchor with baked-weight amplitude', () => {
    const after = sway.vertex.chunks.begin_vertex.after
    expect(after).toContain('(batchingMatrix * vec4(swayAnchor, 1.0)).xyz')
    expect(after).toContain('(instanceMatrix * vec4(swayAnchor, 1.0)).xyz')
    expect(after).toContain('float swayWeight = _sway')
    expect(after).toContain('* uSwayStrength * swayWeight')
  })

  it('ramps on no world height: world-baked batches would pin terrace foliage', () => {
    const after = sway.vertex.chunks.begin_vertex.after
    expect(after).not.toContain('position.y')
    expect(after).not.toContain('smoothstep')
  })

  it('declares the baked weight under its loader-lowercased name', () => {
    expect(sway.vertex.header).toContain('attribute float _sway')
    expect(sway.depthVertex?.header).toContain('attribute float _sway')
  })

  it('defaults the strength to inert: still renders sit on the authored shape', () => {
    expect(sway.uniforms.uSwayStrength.value).toBe(0)
  })
})
