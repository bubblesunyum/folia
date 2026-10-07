import { describe, expect, it, vi } from 'vitest'
import forumParams from '../../assets/blender/cortico/forum.json' with { type: 'json' }
import forumLayout from '../../assets/blender/cortico/forum-layout.json' with { type: 'json' }
import fragmentParams from '../../assets/blender/cortico/fragment.json' with { type: 'json' }
import manifest from '../../assets/manifest.json' with { type: 'json' }
import { listCases, listProjects } from '../content/load'
import {
  FORUM_FLOOR_SLOT,
  isPedestalSlot,
  nextTapState,
  PEDESTAL_ANCHOR_BY_SLUG,
  pedestalOnlyForPath,
  pedestalSlotBySlug,
  resolveCaseNav,
  shouldCloseOnMiss,
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

/** Every cortico case slug, sorted: the only project with pedestals (fol-ya7). */
function corticoSlugs(): string[] {
  return listCases('cortico').sort()
}

const PLATFORM = pedestalSlotBySlug().platform
const RECORDER = pedestalSlotBySlug().recorder
const MEDLEY = pedestalSlotBySlug().medley
if (PLATFORM === undefined || RECORDER === undefined || MEDLEY === undefined) {
  throw new Error('pedestals.test: content cases missing from the slot map')
}

/** A slot no pedestal or floor uses, whatever the allocator hands out. */
const SPARE = Math.max(FORUM_FLOOR_SLOT, PLATFORM, RECORDER, MEDLEY) + 100

describe('slug ↔ slot mapping', () => {
  it('derives every pedestal slot from the cortico cases and the manifest forum groups', () => {
    expect(Object.keys(pedestalSlotBySlug()).sort()).toEqual(corticoSlugs())
    expect(pedestalSlotBySlug()).toEqual(
      Object.fromEntries(corticoSlugs().map((slug) => [slug, manifestSlot(slug)])),
    )
    expect(FORUM_FLOOR_SLOT).toBe(manifestSlot('forum'))
  })

  it('keeps every pedestal on its own slot, off the floor', () => {
    const slots = Object.values(pedestalSlotBySlug())
    expect(new Set(slots).size).toBe(slots.length)
    for (const slot of slots) expect(slot).not.toBe(FORUM_FLOOR_SLOT)
  })

  it('round-trips every cortico slug', () => {
    for (const slug of corticoSlugs()) {
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

  it('restricts lift under every content project', () => {
    for (const project of listProjects()) {
      expect(pedestalOnlyForPath(`/${project}`)).toBe(true)
      expect(pedestalOnlyForPath(`/${project}/platform`)).toBe(true)
    }
  })

  it('leaves town-level hover alone', () => {
    expect(pedestalOnlyForPath('/')).toBe(false)
    expect(pedestalOnlyForPath('/corticosteroid')).toBe(false)
    expect(pedestalOnlyForPath('/unknown-project')).toBe(false)
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

describe('shouldCloseOnMiss', () => {
  it('a clean miss closes an open case on a project path', () => {
    expect(shouldCloseOnMiss(null, '/cortico/platform', 'platform')).toBe(true)
  })

  it('a scenery hit holds the panel', () => {
    expect(shouldCloseOnMiss(PLATFORM, '/cortico/platform', 'platform')).toBe(false)
    expect(shouldCloseOnMiss(FORUM_FLOOR_SLOT, '/cortico/platform', 'platform')).toBe(false)
  })

  it('a miss with no case open closes nothing', () => {
    expect(shouldCloseOnMiss(null, '/cortico/platform', null)).toBe(false)
  })

  it('a miss outside project paths does nothing (town level keeps /)', () => {
    expect(shouldCloseOnMiss(null, '/', 'platform')).toBe(false)
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

  it('routes an explicit project even off-path', () => {
    expect(resolveCaseNav('/', 'platform', 'cortico')).toEqual({
      to: '/cortico/platform',
      replace: false,
    })
  })

  it('fails closed off-path with no project instead of guessing one', () => {
    expect(() => resolveCaseNav('/', 'platform')).toThrowError(/no project/)
  })

  it('carries the QA search onto the case path, leaving bare calls bare', () => {
    const night = resolveCaseNav('/cortico', 'platform', undefined, '?time=22:00')
    expect(night.replace).toBe(false)
    expect(new URL(night.to, 'http://x').pathname).toBe('/cortico/platform')
    expect(new URL(night.to, 'http://x').searchParams.get('time')).toBe('22:00')
    const swap = resolveCaseNav('/cortico/platform', 'recorder', undefined, '?time=22:00&sway=off')
    expect(swap.replace).toBe(true)
    expect(new URL(swap.to, 'http://x').pathname).toBe('/cortico/recorder')
    expect(new URL(swap.to, 'http://x').searchParams.get('time')).toBe('22:00')
    expect(new URL(swap.to, 'http://x').searchParams.get('sway')).toBe('off')
    expect(resolveCaseNav('/cortico', 'platform', 'cortico', '')).toEqual({
      to: '/cortico/platform',
      replace: false,
    })
  })
})

describe('second-project probe (fol-ya7)', () => {
  it('a beta-shaped project without forum groups never breaks the import', async () => {
    vi.resetModules()
    vi.doMock('../content/load', () => ({
      listProjects: () => ['beta', 'cortico'],
      listCases: (project: string): string[] =>
        project === 'cortico' ? ['medley', 'platform', 'recorder'] : ['alpha'],
    }))
    const probe = await import('./pedestals')
    // Beta cases fail closed per route: no slot, no lift, but no throw.
    expect(probe.slotForSlug('alpha')).toBeNull()
    expect(probe.slotForSlug('platform')).not.toBeNull()
    expect(probe.pedestalOnlyForPath('/beta')).toBe(true)
    expect(probe.pedestalOnlyForPath('/beta/alpha')).toBe(true)
    expect(probe.pedestalOnlyForPath('/gamma')).toBe(false)
    // Beta routes still resolve when the caller passes the project.
    expect(probe.resolveCaseNav('/beta', 'alpha', 'beta')).toEqual({
      to: '/beta/alpha',
      replace: false,
    })
    expect(probe.resolveCaseNav('/beta/alpha', 'alpha', 'beta')).toEqual({
      to: '/beta/alpha',
      replace: true,
    })
    vi.doUnmock('../content/load')
  })
})

describe('forum layout single source (fol-bll)', () => {
  it('forum.json carries no placement copy: the layout file owns it', () => {
    expect('centre' in forumParams).toBe(false)
    expect('floor_top' in forumParams).toBe(false)
  })

  it('layout placement matches the fragment top terrace it sits on', () => {
    const levels = fragmentParams.terraces.levels
    const top = levels.reduce((a, b) => (b.top > a.top ? b : a))
    expect(top.centre).toEqual(forumLayout.centre)
    // The medallion top sits 0.10 above the terrace; its 0.12 slab sinks
    // 0.02 in so the contact faces never z-fight (forum.py).
    expect(forumLayout.floor_top - top.top).toBeCloseTo(0.1, 9)
  })

  it('anchors match the Blender placement math (Blender XY → three XZ)', () => {
    const [cx, cy] = forumLayout.centre
    const { radius } = forumParams.pedestal
    for (const spot of forumParams.pedestal.spots) {
      const anchor = PEDESTAL_ANCHOR_BY_SLUG[spot.slug as keyof typeof PEDESTAL_ANCHOR_BY_SLUG]
      const radians = (spot.at * Math.PI) / 180
      const px = (cx as number) + radius * Math.cos(radians)
      const py = (cy as number) + radius * Math.sin(radians)
      expect(anchor[0]).toBeCloseTo(px, 9)
      expect(anchor[2]).toBeCloseTo(-py, 9)
      // Focus floats above the pedestal top, below the wisp sky.
      expect(anchor[1]).toBeGreaterThan(forumLayout.floor_top)
      expect(anchor[1]).toBeLessThan(forumLayout.floor_top + 2)
    }
  })

  it('anchor, slot, spot, and content keys agree: drift fails here', () => {
    const anchors = Object.keys(PEDESTAL_ANCHOR_BY_SLUG).sort()
    const slots = Object.keys(pedestalSlotBySlug()).sort()
    const spots = forumParams.pedestal.spots.map((s) => s.slug).sort()
    const groups = Object.keys(forumGroups)
      .filter((name) => name !== 'forum')
      .sort()
    expect(anchors).toEqual(slots)
    expect(anchors).toEqual(spots)
    expect(anchors).toEqual(groups)
    expect(slots).toEqual(listCases('cortico').sort())
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
