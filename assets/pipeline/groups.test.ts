import { describe, expect, it } from 'vitest'
import { MAX_GROUPS } from '../../src/materials/features'
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
    expect(() => allocateSlots('b', { fresh: 0 }, full)).toThrowError(/no uGroupState slot left/)
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
})
