// Pedestal ↔ case-study mapping for the cortico forum (fol-l1r.5, D-009).
// Pure core: slugs come from the content glob (src/content/load.ts) — a new
// .mdx with a matching forum group routes with no other edit — slots come
// from the manifest's cortico/forum groups (assets/manifest.json), so a forum
// rename/remap flows through instead of misrouting clicks with green tests,
// and anchors come from the forum layout file
// (assets/blender/cortico/forum-layout.json), the same placement Blender
// builds the forum from, so rigs and geometry agree by construction.
// The canvas rigs own the raycaster and the springs; everything here is
// plain data with tests.

import forumLayout from '../../assets/blender/cortico/forum-layout.json' with { type: 'json' }
import manifest from '../../assets/manifest.json' with { type: 'json' }
import { listCases, listProjects } from '../content/load'

/** The cortico/forum group slots from the asset manifest, fail closed. */
const forumSlots: Readonly<Record<string, number>> = (() => {
  const slots = manifest['cortico/forum']?.groups
  if (!slots) throw new Error('pedestals: missing "cortico/forum" groups in the asset manifest')
  return slots
})()

/** A required forum group slot: throws on a missing name, never defaults. */
function requireForumSlot(name: string): number {
  const slot = forumSlots[name]
  if (slot === undefined) {
    throw new Error(`pedestals: missing "cortico/forum" group "${name}" in the asset manifest`)
  }
  return slot
}

/** The forum floor medallion: hoverable geometry that must never lift. */
export const FORUM_FLOOR_SLOT = requireForumSlot('forum')

/**
 * The one project with 3D pedestals: only its cases resolve through the
 * cortico/forum groups. Any other project's cases return null from
 * slotForSlug (fail closed per route) instead of throwing here at import, so
 * a beta-shaped second project can't crash the town (fol-ya7).
 */
const PEDESTAL_PROJECT = 'cortico'

/**
 * Case slug → town-wide group slot, via a memoized lazy getter. Derived
 * from the cortico cases in the content glob: every cortico case needs a
 * forum group of the same name, and a cortico case without one fails closed
 * here (at first slot use, not at import) instead of routing clicks
 * nowhere. Lazy so importing this module under raw Node (Playwright, no
 * Vite transform for the content glob) never executes the glob: the specs
 * only need PEDESTAL_ANCHOR_BY_SLUG, which stays eager below.
 */
export function pedestalSlotBySlug(): Readonly<Record<string, number>> {
  if (slotCache === null) {
    const table = new Map<string, number>()
    for (const slug of listCases(PEDESTAL_PROJECT)) {
      table.set(slug, requireForumSlot(slug))
    }
    slotCache = Object.fromEntries(table)
  }
  return slotCache
}

let slotCache: Readonly<Record<string, number>> | null = null

/** Every group name the manifest declares for cortico/forum. */
type ForumGroupName = keyof (typeof manifest)['cortico/forum']['groups']

/**
 * A case slug with a pedestal: every forum group except the floor. Derived
 * from the manifest (not hand-kept), so a forum rename flows into the type
 * with the remap instead of misrouting clicks with green tests (fol-ya7).
 */
export type PedestalSlug = Exclude<ForumGroupName, 'forum'>

/** A forum group minus the floor: the manifest source behind PedestalSlug. */
function isPedestalSlug(slug: string): slug is PedestalSlug {
  return slug !== 'forum' && forumSlots[slug] !== undefined
}

/** Slug by slot, derived from the slot map so a remap can't desync it. */
export function slugByPedestalSlot(): Readonly<Record<number, PedestalSlug>> {
  if (reverseCache === null) {
    const reverse = new Map<number, PedestalSlug>()
    for (const [slug, slot] of Object.entries(pedestalSlotBySlug())) {
      if (!isPedestalSlug(slug)) {
        throw new Error(`pedestals: case "${slug}" is not a cortico/forum pedestal group`)
      }
      if (reverse.has(slot)) {
        throw new Error(`pedestals: "cortico/forum" slot ${slot} maps to more than one pedestal`)
      }
      reverse.set(slot, slug)
    }
    reverseCache = Object.fromEntries(reverse)
  }
  return reverseCache
}

let reverseCache: Readonly<Record<number, PedestalSlug>> | null = null

/**
 * Pedestal focus targets in world metres (three.js x, y-up, z): laptop
 * (platform), phone (recorder), glyph (medley). Single-sourced from the
 * forum layout file (fol-bll) — the same placement Blender builds from — so
 * the values can never drift from the geometry. The camera ease and the wisp
 * perch aim here; exact contact doesn't matter, the pedestal filling the
 * left area does.
 */
export const PEDESTAL_ANCHOR_BY_SLUG: Readonly<
  Record<PedestalSlug, readonly [number, number, number]>
> = (() => {
  const layout = forumLayout as unknown as {
    anchors?: Record<string, readonly number[] | undefined>
  }
  const anchors = layout.anchors
  if (anchors === undefined) {
    throw new Error('pedestals: forum layout file has no "anchors" map')
  }
  // Every pedestal group needs an anchor and every anchor needs a group: a
  // new pedestal without one fails closed here instead of aiming nowhere.
  const groups = Object.keys(forumSlots)
    .filter((name) => name !== 'forum')
    .sort()
  const names = Object.keys(anchors).sort()
  if (JSON.stringify(names) !== JSON.stringify(groups)) {
    throw new Error(
      `pedestals: forum layout anchors [${names.join(', ')}] disagree with ` +
        `forum groups [${groups.join(', ')}]`,
    )
  }
  const table: Record<string, readonly [number, number, number]> = {}
  for (const name of names) {
    const anchor = anchors[name]
    const [x, y, z] = anchor ?? []
    if (
      anchor === undefined ||
      anchor.length !== 3 ||
      x === undefined ||
      y === undefined ||
      z === undefined ||
      ![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      throw new Error(`pedestals: forum layout anchor "${name}" is not a finite xyz triple`)
    }
    table[name] = [x, y, z]
  }
  return table as Readonly<Record<PedestalSlug, readonly [number, number, number]>>
})()

/** The orbit target with no case in view (mirrors LookDevScene's default). */
export const TOWN_ORBIT_TARGET: readonly [number, number, number] = [0, 2, 0]

/**
 * The focus anchor for a case slug: throws on a routed slug with no anchor
 * instead of aiming the camera at nowhere (fail closed, fol-ya7).
 */
export function requireAnchor(slug: PedestalSlug): readonly [number, number, number] {
  if (!(slug in PEDESTAL_ANCHOR_BY_SLUG)) {
    throw new Error(`pedestals: no focus anchor for case "${slug}"`)
  }
  return PEDESTAL_ANCHOR_BY_SLUG[slug]
}

/** The group slot for a case slug, or null for unknown ids (fail closed). */
export function slotForSlug(slug: string): number | null {
  return pedestalSlotBySlug()[slug] ?? null
}

/** The case slug for a group slot, or null for scenery and the floor. */
export function slugForSlot(slot: number): PedestalSlug | null {
  return slugByPedestalSlot()[slot] ?? null
}

/** Only the three pedestal slots lift; the floor and town never do here. */
export function isPedestalSlot(slot: number): boolean {
  return slugForSlot(slot) !== null
}

/**
 * Under /<project> (the place and its cases) only pedestals lift+glow
 * (D-021); at town level the existing whole-town hover stands, so
 * hover.spec's slots keep resolving there. Project pages come from the
 * content glob, so a new project restricts like cortico with no other edit.
 */
export function pedestalOnlyForPath(pathname: string): boolean {
  return projectFromPath(pathname) !== null
}

/** Whether a slot may take lift/route at a path: the one filter both picking rigs share. */
export function shouldLiftSlot(slot: number, pathname: string): boolean {
  return !pedestalOnlyForPath(pathname) || isPedestalSlot(slot)
}

export interface CaseNav {
  to: string
  replace: boolean
}

/**
 * Pedestal taps route to /<project>/<slug> (D-004, D-021): a push from the
 * place, a replace when swapping the open panel case-for-case. The project
 * comes from the caller, which reads it from its route params, falling back
 * to the current path; off-path with no project it throws instead of
 * guessing the first content project (fail closed).
 */
export function resolveCaseNav(currentPath: string, slug: string, project?: string): CaseNav {
  const fromPath = projectFromPath(currentPath)
  const resolved = project ?? fromPath
  if (resolved === null) {
    throw new Error(`pedestals: cannot route case "${slug}" with no project (pass it explicitly)`)
  }
  const onCase = fromPath !== null && isCasePath(currentPath, fromPath)
  return { to: `/${resolved}/${slug}`, replace: onCase }
}

/** The known project a path sits under, or null at town level and elsewhere. */
function projectFromPath(pathname: string): string | null {
  for (const candidate of listProjects()) {
    if (
      pathname === `/${candidate}` ||
      pathname === `/${candidate}/` ||
      pathname.startsWith(`/${candidate}/`)
    ) {
      return candidate
    }
  }
  return null
}

/** Whether a path is a case page (two segments) rather than the place itself. */
function isCasePath(pathname: string, project: string): boolean {
  const prefix = `/${project}/`
  if (!pathname.startsWith(prefix)) return false
  const rest = pathname.slice(prefix.length)
  const slug = rest.endsWith('/') ? rest.slice(0, -1) : rest
  return slug.length > 0 && !slug.includes('/')
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
