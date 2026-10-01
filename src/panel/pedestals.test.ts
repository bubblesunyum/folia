import { describe, expect, it } from 'vitest'
import {
  FORUM_FLOOR_SLOT,
  isPedestalSlot,
  nextTapState,
  PEDESTAL_ANCHOR_BY_SLUG,
  PEDESTAL_SLOT_BY_SLUG,
  pedestalOnlyForPath,
  resolveCaseNav,
  shouldLiftSlot,
  slotForSlug,
  slugForSlot,
} from './pedestals'

describe('slug ↔ slot mapping', () => {
  it('pins the fol-l1r.4 manifest slots', () => {
    expect(PEDESTAL_SLOT_BY_SLUG).toEqual({ platform: 9, recorder: 10, medley: 8 })
    expect(FORUM_FLOOR_SLOT).toBe(7)
  })

  it('round-trips every pedestal slug', () => {
    for (const slug of ['platform', 'recorder', 'medley'] as const) {
      const slot = slotForSlug(slug)
      expect(slot).not.toBeNull()
      expect(slugForSlot(slot as number)).toBe(slug)
    }
  })

  it('fails closed on unknown slugs and scenery slots', () => {
    expect(slotForSlug('cortico')).toBeNull()
    expect(slotForSlug('')).toBeNull()
    expect(slugForSlot(FORUM_FLOOR_SLOT)).toBeNull()
    expect(slugForSlot(0)).toBeNull()
    expect(slugForSlot(99)).toBeNull()
  })

  it('only the three pedestals lift: the floor and town never do', () => {
    expect(isPedestalSlot(8)).toBe(true)
    expect(isPedestalSlot(9)).toBe(true)
    expect(isPedestalSlot(10)).toBe(true)
    expect(isPedestalSlot(FORUM_FLOOR_SLOT)).toBe(false)
    expect(isPedestalSlot(0)).toBe(false)
    expect(isPedestalSlot(6)).toBe(false)
  })

  it('every pedestal has a focus anchor near the forum terrace', () => {
    for (const [slug, anchor] of Object.entries(PEDESTAL_ANCHOR_BY_SLUG)) {
      expect(anchor).toHaveLength(3)
      // Forum terrace airspace: x in [-5, -2], y-up in [3, 5], z in [1, 4].
      expect(anchor[0]).toBeGreaterThan(-5)
      expect(anchor[0]).toBeLessThan(-2)
      expect(anchor[1]).toBeGreaterThan(3)
      expect(anchor[1]).toBeLessThan(5)
      expect(anchor[2]).toBeGreaterThan(1)
      expect(anchor[2]).toBeLessThan(4)
      expect(slotForSlug(slug)).not.toBeNull()
    }
  })
})

describe('pedestalOnlyForPath', () => {
  it('restricts lift under /cortico and its cases, with or without the slash', () => {
    expect(pedestalOnlyForPath('/cortico')).toBe(true)
    expect(pedestalOnlyForPath('/cortico/')).toBe(true)
    expect(pedestalOnlyForPath('/cortico/platform')).toBe(true)
    expect(pedestalOnlyForPath('/cortico/platform/')).toBe(true)
  })

  it('leaves town-level hover alone', () => {
    expect(pedestalOnlyForPath('/')).toBe(false)
    expect(pedestalOnlyForPath('/corticosteroid')).toBe(false)
  })
})

describe('shouldLiftSlot', () => {
  it('lifts only pedestals under /cortico', () => {
    expect(shouldLiftSlot(9, '/cortico')).toBe(true)
    expect(shouldLiftSlot(9, '/cortico/platform')).toBe(true)
    expect(shouldLiftSlot(7, '/cortico')).toBe(false)
    expect(shouldLiftSlot(3, '/cortico')).toBe(false)
  })

  it('lifts everything at town level', () => {
    expect(shouldLiftSlot(9, '/')).toBe(true)
    expect(shouldLiftSlot(7, '/')).toBe(true)
    expect(shouldLiftSlot(3, '/')).toBe(true)
  })
})

describe('resolveCaseNav', () => {
  it('pushes from the place onto a case', () => {
    expect(resolveCaseNav('/cortico', 'platform')).toEqual({
      to: '/cortico/platform',
      replace: false,
    })
    expect(resolveCaseNav('/cortico/', 'medley')).toEqual({ to: '/cortico/medley', replace: false })
  })

  it('replaces case-for-case so panel swaps never stack history (D-021)', () => {
    expect(resolveCaseNav('/cortico/platform', 'recorder')).toEqual({
      to: '/cortico/recorder',
      replace: true,
    })
    expect(resolveCaseNav('/cortico/platform/', 'recorder')).toEqual({
      to: '/cortico/recorder',
      replace: true,
    })
  })

  it('pushes from anywhere else', () => {
    expect(resolveCaseNav('/', 'platform')).toEqual({ to: '/cortico/platform', replace: false })
  })
})

describe('nextTapState', () => {
  it('a mouse click opens any pedestal at once', () => {
    expect(nextTapState(null, 9, 'mouse')).toEqual({ action: 'open', armed: null })
    expect(nextTapState(9, 10, 'mouse')).toEqual({ action: 'open', armed: null })
  })

  it('a first touch tap arms, the second tap on the same pedestal opens', () => {
    expect(nextTapState(null, 9, 'touch')).toEqual({ action: 'arm', armed: 9 })
    expect(nextTapState(9, 9, 'touch')).toEqual({ action: 'open', armed: null })
  })

  it('a touch tap on another pedestal re-arms instead of opening', () => {
    expect(nextTapState(9, 10, 'touch')).toEqual({ action: 'arm', armed: 10 })
  })

  it('a miss clears a stale arm instead of letting it fire later', () => {
    expect(nextTapState(9, null, 'touch')).toEqual({ action: 'ignore', armed: null })
    expect(nextTapState(9, null, 'mouse')).toEqual({ action: 'ignore', armed: null })
  })

  it('a scenery tap never opens and keeps the armed tap', () => {
    expect(nextTapState(9, 7, 'touch')).toEqual({ action: 'ignore', armed: 9 })
    expect(nextTapState(null, 7, 'mouse')).toEqual({ action: 'ignore', armed: null })
  })
})
