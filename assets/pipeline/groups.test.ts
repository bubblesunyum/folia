import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_GROUPS } from '../../src/groupSlots'
import { allocateSlots, assetLocalIds, type GroupRegistry } from './groups'

describe('allocateSlots', () => {
  it('assigns 0..N in sorted name order on a fresh registry', () => {
    const { table, remap } = allocateSlots('cortico/forum', { terrace: 1, ground: 0 }, {})
    expect(table).toEqual({ ground: 0, terrace: 1 })
    expect([...remap]).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('gives a second asset reusing the same local ids disjoint slots', () => {
    const registry: GroupRegistry = {
      'cortico/fragment': { ground: 0, terrace: 1, canopy: 2, shell: 3, planting: 4 },
    }
    const { table } = allocateSlots('cortico/forum', { deck: 0, rail: 1 }, registry)
    expect(table).toEqual({ deck: 5, rail: 6 })
  })

  it('keeps existing slots when a group is added', () => {
    const registry: GroupRegistry = {
      'cortico/fragment': { ground: 0, terrace: 1, canopy: 2, shell: 3, planting: 4 },
      'cortico/forum': { deck: 5, rail: 6 },
    }
    const { table } = allocateSlots('cortico/forum', { deck: 0, rail: 1, stair: 2 }, registry)
    expect(table).toEqual({ deck: 5, rail: 6, stair: 7 })
  })

  it('is stable on rebuild with no changes', () => {
    const registry: GroupRegistry = {
      'cortico/fragment': { ground: 0, terrace: 1, canopy: 2, shell: 3, planting: 4 },
      'cortico/forum': { deck: 5, rail: 6 },
    }
    expect(
      allocateSlots(
        'cortico/fragment',
        { ground: 0, terrace: 1, canopy: 2, shell: 3, planting: 4 },
        registry,
      ).table,
    ).toEqual(registry['cortico/fragment'])
    expect(allocateSlots('cortico/forum', { deck: 0, rail: 1 }, registry).table).toEqual(
      registry['cortico/forum'],
    )
  })

  it('throws past MAX_GROUPS instead of colliding', () => {
    const full: GroupRegistry = {
      a: Object.fromEntries(Array.from({ length: MAX_GROUPS }, (_, i) => [`g${i}`, i])),
    }
    expect(() => allocateSlots('b', { fresh: 0 }, full)).toThrowError(/no group slot left/)
  })

  it('reuses a renamed group\u2019s slot instead of leaking it', () => {
    const registry: GroupRegistry = {
      'cortico/forum': { deck: 5, rail: 6 },
    }
    const { table, remap } = allocateSlots('cortico/forum', { concourse: 1, deck: 0 }, registry)
    expect(table).toEqual({ concourse: 6, deck: 5 })
    expect([...remap]).toEqual([
      [1, 6],
      [0, 5],
    ])
  })

  it('a removed group frees its slot for the next new group, then mints', () => {
    const registry: GroupRegistry = {
      'cortico/fragment': { ground: 0, terrace: 1, canopy: 2, shell: 3, planting: 4 },
      'cortico/forum': { deck: 5, rail: 6 },
    }
    const { table } = allocateSlots('cortico/forum', { arcade: 0, deck: 1, stair: 2 }, registry)
    expect(table).toEqual({ arcade: 6, deck: 5, stair: 7 })
  })

  it('never hands another asset\u2019s slot to a rename', () => {
    const registry: GroupRegistry = {
      'cortico/fragment': { ground: 0, terrace: 1 },
      'cortico/forum': { deck: 1, rail: 6 },
    }
    // forum's deck collides with fragment's terrace in this corrupt registry:
    // fail closed rather than merging two groups into slot 1.
    expect(() => allocateSlots('cortico/forum', { deck: 0, rail: 1 }, registry)).toThrowError(
      /already taken/,
    )
  })

  it('throws on duplicate local _IDs instead of merging two groups', () => {
    expect(() => allocateSlots('cortico/forum', { deck: 0, rail: 0 }, {})).toThrowError(
      /duplicate local _ID 0/,
    )
  })
})

describe('assetLocalIds', () => {
  it('reads the fragment params', () => {
    expect(assetLocalIds('cortico/fragment')).toEqual({
      ground: 0,
      terrace: 1,
      canopy: 2,
      shell: 3,
      planting: 4,
    })
  })

  it('reads the forum params: one group per pedestal plus the floor', () => {
    expect(assetLocalIds('cortico/forum')).toEqual({
      forum: 0,
      medley: 1,
      platform: 2,
      recorder: 3,
    })
  })
})

describe('cortico/forum slots and batches (fol-l1r.4)', () => {
  type ManifestRecord = {
    groups?: GroupRegistry[string]
    triangles?: Record<string, number>
  }

  function readManifest(): Record<string, ManifestRecord> {
    return JSON.parse(
      readFileSync(join(resolve(import.meta.dirname, '../..'), 'assets/manifest.json'), 'utf8'),
    )
  }

  const registry: GroupRegistry = {
    'cortico/fragment': { ground: 1, terrace: 4, canopy: 0, shell: 3, planting: 2 },
    'cortico/meadow': { planting: 5, terrace: 6 },
  }

  it('gives the three pedestals disjoint slots after fragment and meadow', () => {
    // Sorted name order: forum, medley, platform, recorder.
    const { table, remap } = allocateSlots(
      'cortico/forum',
      assetLocalIds('cortico/forum'),
      registry,
    )
    expect(table).toEqual({ forum: 7, medley: 8, platform: 9, recorder: 10 })
    expect([...remap.values()].sort((a, b) => a - b)).toEqual([7, 8, 9, 10])
  })

  it('the committed manifest matches a fresh allocation (no slot collisions)', () => {
    const manifest = readManifest()
    const rest: GroupRegistry = Object.fromEntries(
      Object.entries(manifest)
        .filter(([asset]) => asset !== 'cortico/forum')
        .map(([asset, record]) => [asset, record.groups ?? {}]),
    )
    const { table } = allocateSlots('cortico/forum', assetLocalIds('cortico/forum'), rest)
    expect(manifest['cortico/forum']?.groups).toEqual(table)
    // Every town-wide slot is used at most once.
    const slots = Object.values(manifest).flatMap((record) => Object.values(record.groups ?? {}))
    expect(new Set(slots).size).toBe(slots.length)
    expect(Math.max(...slots)).toBeLessThan(MAX_GROUPS)
  })

  it('the forum stays lean and reuses shared batches only', () => {
    const triangles = readManifest()['cortico/forum']?.triangles ?? {}
    // Shared batches only: no new materials, so no new programs (D-012).
    // foliage joined with the forum planter ring (fol-l7d.3) — still shared.
    expect(Object.keys(triangles).sort()).toEqual(['cream', 'foliage', 'gold', 'neon'])
    // ~6k tris against the fragment's ~132k: the slice-exit headroom (D-063)
    // must survive the forum.
    const total = Object.values(triangles).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(10_000)
  })
})
