// Hood-level hover composition (D-021, D-074, fol-l7d.8): pure data, no
// renderer. The expectations pin known manifest values rather than deriving
// them from the manifest, so a forum remap fails the test instead of
// misrouting hovers with green tests; manifest-derivation lives only in
// hoods.ts.

import { describe, expect, it } from 'vitest'
import {
  focusSlotsForTarget,
  hoodForSlot,
  hoverSlotsForSlot,
  isHoodTarget,
  slotsForHood,
} from './hoods'

/**
 * Pinned against assets/manifest.json today: cortico/forum carries the floor
 * (forum 7) plus the three pedestals (medley 8, platform 9, recorder 10);
 * fragment (0-4) and meadow (5-6) bring the cortico hood to 11 slots.
 */
const FORUM_PEDESTAL_SLOTS = [8, 9, 10]
const CORTICO_SLOT_COUNT = 11

describe('slot ↔ hood mapping', () => {
  it('pins the forum pedestal slots inside the cortico hood', () => {
    // Forum floor plus pedestals today: the whole neighborhood, not one group.
    const slots = slotsForHood('cortico')
    expect(slots).toEqual(expect.arrayContaining([7, ...FORUM_PEDESTAL_SLOTS]))
    expect(slots.length).toBeGreaterThanOrEqual(CORTICO_SLOT_COUNT)
    for (const slot of [7, ...FORUM_PEDESTAL_SLOTS]) expect(hoodForSlot(slot)).toBe('cortico')
  })

  it('fails closed on unknown slots and hoods', () => {
    expect(hoodForSlot(999)).toBeNull()
    expect(slotsForHood('glyphite')).toEqual([])
    expect(isHoodTarget('cortico')).toBe(true)
    expect(isHoodTarget('glyphite')).toBe(false)
    expect(isHoodTarget('')).toBe(false)
  })
})

describe('hoverSlotsForSlot', () => {
  it('lifts the whole hood at town level, one slot elsewhere', () => {
    const lifted = hoverSlotsForSlot(9, true)
    expect(lifted).toEqual(expect.arrayContaining([7, ...FORUM_PEDESTAL_SLOTS]))
    expect(lifted.length).toBeGreaterThanOrEqual(CORTICO_SLOT_COUNT)
    expect(hoverSlotsForSlot(9, false)).toEqual([9])
  })

  it('lifts a hoodless slot alone, never the town', () => {
    expect(hoverSlotsForSlot(999, true)).toEqual([999])
    expect(hoverSlotsForSlot(999, false)).toEqual([999])
  })
})

describe('focusSlotsForTarget', () => {
  const bySlug = (slug: string): number | null => (slug === 'platform' ? 9 : null)

  it('clears on empty and lifts nothing unknown (fail closed)', () => {
    expect(focusSlotsForTarget('', bySlug)).toEqual([])
    expect(focusSlotsForTarget('nope', () => null)).toEqual([])
  })

  it('lifts one slot for a pedestal slug, the hood for a hood id', () => {
    expect(focusSlotsForTarget('platform', bySlug)).toEqual([9])
    const lifted = focusSlotsForTarget('cortico', () => null)
    expect(lifted).toEqual(expect.arrayContaining([7, ...FORUM_PEDESTAL_SLOTS]))
    expect(lifted.length).toBeGreaterThanOrEqual(CORTICO_SLOT_COUNT)
  })
})
