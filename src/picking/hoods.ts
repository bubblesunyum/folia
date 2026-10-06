// Per-hood hover composition for the town level (D-021, D-074, fol-l7d.8).
//
// At `/` the whole cortico neighborhood lifts and glows as one: the pick
// still resolves a single group slot against the derived hit volumes
// (D-074, `hitVolumes.ts`), and the lift expands here to every slot the hood
// owns. Under `/cortico` the expansion stays one slot and the pedestal filter
// (`pedestals.shouldLiftSlot`, applied by the caller) keeps only the three
// pedestals, so one composition proves both rows of the D-021 map with no
// second system.
//
// Pure core, three-free: the slot↔hood tables derive from the asset manifest
// (`assets/manifest.json`: `<hood>/<object>` assets carry `groups`), so a
// remap or a new hood flows through instead of misrouting hovers with green
// tests. The R3F rig (`scene/HoverHighlight.tsx`) owns the raycaster and the
// springs; everything here is plain data with tests.

import manifest from '../../assets/manifest.json' with { type: 'json' }

/** Group slots per hood, derived from the manifest's per-asset groups. */
const slotsByHood: ReadonlyMap<string, readonly number[]> = (() => {
  const table = new Map<string, Set<number>>()
  const owner = new Map<number, string>()
  const records = manifest as Record<string, { groups?: Record<string, number> | undefined }>
  for (const [asset, record] of Object.entries(records)) {
    // Hood is the top path segment: when a future town/skeleton asset ships,
    // its slots attribute to hood 'town' here, and town-level hover would
    // expand lift town-wide via hoverSlotsForSlot — flag for that wiring.
    const hood = asset.split('/')[0] ?? ''
    if (hood === '' || record.groups === undefined) continue
    for (const slot of Object.values(record.groups)) {
      const seen = owner.get(slot)
      if (seen !== undefined && seen !== hood) {
        throw new Error(`hoods: slot ${slot} belongs to "${seen}" and "${hood}"`)
      }
      owner.set(slot, hood)
      let slots = table.get(hood)
      if (!slots) {
        slots = new Set<number>()
        table.set(hood, slots)
      }
      slots.add(slot)
    }
  }
  return new Map(
    [...table.entries()].map(([hood, slots]) => [hood, [...slots].sort((a, b) => a - b)] as const),
  )
})()

/** Slot → hood, inverted once so picks resolve without a scan. */
const hoodBySlot: ReadonlyMap<number, string> = (() => {
  const inverted = new Map<number, string>()
  for (const [hood, slots] of slotsByHood) {
    for (const slot of slots) inverted.set(slot, hood)
  }
  return inverted
})()

/** The hood a group slot belongs to, or null for scenery with no hood. */
export function hoodForSlot(slot: number): string | null {
  return hoodBySlot.get(slot) ?? null
}

/** Every group slot a hood owns, ascending; empty for unknown hoods. */
export function slotsForHood(hood: string): readonly number[] {
  return slotsByHood.get(hood) ?? []
}

/** Whether a focus id names a whole hood rather than one pedestal slug. */
export function isHoodTarget(targetId: string): boolean {
  return slotsByHood.has(targetId)
}

/**
 * Town-level hover expansion (D-021): at town level the picked slot lifts its
 * whole hood; anywhere else the slot stands alone (the caller keeps the
 * pedestal filter). A slot with no hood lifts alone, never the town.
 */
export function hoverSlotsForSlot(slot: number, townLevel: boolean): readonly number[] {
  if (!townLevel) return [slot]
  const hood = hoodForSlot(slot)
  if (hood === null) return [slot]
  return slotsForHood(hood)
}

/**
 * Focus-target resolution for the intent layer's FOCUS_LIFT_EVENT (spec
 * keyboard): focus drives the same lift as hover. Empty clears; a pedestal
 * slug lifts its slot; a hood id lifts the hood (town-level composition, so
 * focusing the town's cortico link reads the same as hovering it); anything
 * else lifts nothing instead of the town (fail closed).
 */
export function focusSlotsForTarget(
  targetId: string,
  slotForSlug: (slug: string) => number | null,
): readonly number[] {
  if (targetId === '') return []
  const slot = slotForSlug(targetId)
  if (slot !== null) return [slot]
  if (isHoodTarget(targetId)) return slotsForHood(targetId)
  return []
}
