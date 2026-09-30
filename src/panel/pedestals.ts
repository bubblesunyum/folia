// Pedestal ↔ case-study mapping for the cortico forum (fol-l1r.5, D-009).
// Pure core: slots come from assets/manifest.json (forum=7, medley=8,
// platform=9, recorder=10), anchors are the approx pedestal worlds from
// fol-l1r.4 in three.js coords (x, y-up, z). The canvas rigs own the
// raycaster and the springs; everything here is plain data with tests.

/** The forum floor medallion: hoverable geometry that must never lift. */
export const FORUM_FLOOR_SLOT = 7

/** Case slug → town-wide group slot (assets/manifest.json). */
export const PEDESTAL_SLOT_BY_SLUG = {
  platform: 9,
  recorder: 10,
  medley: 8,
} as const

export type PedestalSlug = keyof typeof PEDESTAL_SLOT_BY_SLUG

const SLUG_BY_PEDESTAL_SLOT: Readonly<Record<number, PedestalSlug>> = {
  9: 'platform',
  10: 'recorder',
  8: 'medley',
}

/**
 * Pedestal focus targets in world metres (three.js x, y-up, z), the approx
 * worlds from fol-l1r.4: laptop slot 9, phone slot 10, glyph slot 8. The
 * camera ease and the wisp perch aim here; exact contact doesn't matter, the
 * pedestal filling the left area does.
 */
export const PEDESTAL_ANCHOR_BY_SLUG: Readonly<
  Record<PedestalSlug, readonly [number, number, number]>
> = {
  platform: [-3.4, 3.6, 1.55],
  recorder: [-4.31, 3.7, 3.13],
  medley: [-2.49, 3.8, 3.13],
}

/** The orbit target with no case in view (mirrors LookDevScene's default). */
export const TOWN_ORBIT_TARGET: readonly [number, number, number] = [0, 2, 0]

/** The group slot for a case slug, or null for unknown ids (fail closed). */
export function slotForSlug(slug: string): number | null {
  const slot: number | undefined = (PEDESTAL_SLOT_BY_SLUG as Readonly<Record<string, number>>)[slug]
  return slot === undefined ? null : slot
}

/** The case slug for a group slot, or null for scenery and the floor. */
export function slugForSlot(slot: number): PedestalSlug | null {
  return SLUG_BY_PEDESTAL_SLOT[slot] ?? null
}

/** Only the three pedestal slots lift; the floor (7) and town never do here. */
export function isPedestalSlot(slot: number): boolean {
  return slugForSlot(slot) !== null
}

/**
 * Under /cortico (the place and its cases) only pedestals lift+glow (D-021);
 * at town level the existing whole-town hover stands, so hover.spec's slots
 * keep resolving there.
 */
export function pedestalOnlyForPath(pathname: string): boolean {
  return pathname === '/cortico' || pathname === '/cortico/' || pathname.startsWith('/cortico/')
}

export interface CaseNav {
  to: string
  replace: boolean
}

/**
 * Pedestal taps route to /cortico/<slug> (D-004, D-021): a push from the
 * place, a replace when swapping the open panel case-for-case.
 */
export function resolveCaseNav(currentPath: string, slug: string): CaseNav {
  const onCase = /^\/cortico\/[^/]+\/?$/.test(currentPath)
  return { to: `/cortico/${slug}`, replace: onCase }
}

export type TapAction = 'open' | 'arm' | 'ignore'

export interface TapState {
  action: TapAction
  /** The armed first-tap slot (touch two-tap), cleared once it opens. */
  armed: number | null
}

/**
 * Click/second-tap routing as a pure step (D-021): mouse opens on click,
 * touch arms on first tap and opens when the same pedestal is tapped again.
 * A miss clears a stale arm (an armed tap must never survive to fire on a
 * later single tap) and never opens; on an open panel the miss is the
 * empty-world close.
 */
export function nextTapState(
  armed: number | null,
  slot: number | null,
  pointerType: string,
): TapState {
  if (slot === null) return { action: 'ignore', armed: null }
  if (!isPedestalSlot(slot)) return { action: 'ignore', armed }
  if (pointerType === 'touch') {
    if (armed === slot) return { action: 'open', armed: null }
    return { action: 'arm', armed: slot }
  }
  return { action: 'open', armed: null }
}
