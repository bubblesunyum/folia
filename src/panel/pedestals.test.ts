import { describe, expect, it } from 'vitest'
import manifest from '../../assets/manifest.json' with { type: 'json' }
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

const rawForumGroups = manifest['cortico/forum']?.groups
if (!rawForumGroups)
  throw new Error('pedestals.test: missing "cortico/forum" groups in the asset manifest')
const forumGroups: Readonly<Record<string, number>> = rawForumGroups

/** The manifest slot for a forum group name: throws, never defaults. */
function manifestSlot(name: string): number {
  const slot = forumGroups[name]
  if (slot === undefined) throw new Error(`pedestals.test: missing "cortico/forum" group "${name}"`)
  return slot
}

const PLATFORM = PEDESTAL_SLOT_BY_SLUG.platform
const RECORDER = PEDESTAL_SLOT_BY_SLUG.recorder
const MEDLEY = PEDESTAL_SLOT_BY_SLUG.medley

/** A slot no pedestal or floor uses, whatever the allocator hands out. */
const SPARE = Math.max(FORUM_FLOOR_SLOT, PLATFORM, RECORDER, MEDLEY) + 100

describe('slug ↔ slot mapping', () => {
  it('derives every pedestal slot from the manifest forum groups', () => {
    expect(PEDESTAL_SLOT_BY_SLUG).toEqual({
      platform: manifestSlot('platform'),
      recorder: manifestSlot('recorder'),
      medley: manifestSlot('medley'),
    })
    expect(FORUM_FLOOR_SLOT).toBe(manifestSlot('forum'))
  })

  it('keeps every pedestal on its own slot, off the floor', () => {
    const slots = Object.values(PEDESTAL_SLOT_BY_SLUG)
    expect(new Set(slots).size).toBe(slots.length)
    for (const slot of slots) expect(slot).not.toBe(FORUM_FLOOR_SLOT)
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
    expect(slugForSlot(SPARE)).toBeNull()
    expect(slugForSlot(SPARE + 1)).toBeNull()
  })

  it('only the three pedestals lift: the floor and town never do', () => {
    expect(isPedestalSlot(MEDLEY)).toBe(true)
    expect(isPedestalSlot(PLATFORM)).toBe(true)
    expect(isPedestalSlot(RECORDER)).toBe(true)
    expect(isPedestalSlot(FORUM_FLOOR_SLOT)).toBe(false)
    expect(isPedestalSlot(SPARE)).toBe(false)
    expect(isPedestalSlot(SPARE + 1)).toBe(false)
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
    expect(shouldLiftSlot(PLATFORM, '/cortico')).toBe(true)
    expect(shouldLiftSlot(PLATFORM, '/cortico/platform')).toBe(true)
    expect(shouldLiftSlot(FORUM_FLOOR_SLOT, '/cortico')).toBe(false)
    expect(shouldLiftSlot(SPARE, '/cortico')).toBe(false)
  })

  it('lifts everything at town level', () => {
    expect(shouldLiftSlot(PLATFORM, '/')).toBe(true)
    expect(shouldLiftSlot(FORUM_FLOOR_SLOT, '/')).toBe(true)
    expect(shouldLiftSlot(SPARE, '/')).toBe(true)
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
    expect(nextTapState(null, PLATFORM, 'mouse')).toEqual({ action: 'open', armed: null })
    expect(nextTapState(PLATFORM, RECORDER, 'mouse')).toEqual({ action: 'open', armed: null })
  })

  it('a first touch tap arms, the second tap on the same pedestal opens', () => {
    expect(nextTapState(null, PLATFORM, 'touch')).toEqual({ action: 'arm', armed: PLATFORM })
    expect(nextTapState(PLATFORM, PLATFORM, 'touch')).toEqual({ action: 'open', armed: null })
  })

  it('a touch tap on another pedestal re-arms instead of opening', () => {
    expect(nextTapState(PLATFORM, RECORDER, 'touch')).toEqual({ action: 'arm', armed: RECORDER })
  })

  it('a miss clears a stale arm instead of letting it fire later', () => {
    expect(nextTapState(PLATFORM, null, 'touch')).toEqual({ action: 'ignore', armed: null })
    expect(nextTapState(PLATFORM, null, 'mouse')).toEqual({ action: 'ignore', armed: null })
  })

  it('a scenery tap never opens and keeps the armed tap', () => {
    expect(nextTapState(PLATFORM, FORUM_FLOOR_SLOT, 'touch')).toEqual({
      action: 'ignore',
      armed: PLATFORM,
    })
    expect(nextTapState(null, FORUM_FLOOR_SLOT, 'mouse')).toEqual({ action: 'ignore', armed: null })
  })
})
