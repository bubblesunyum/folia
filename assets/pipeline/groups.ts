// Global group slots (fol-716, D-061).
//
// `_ID` values are per-asset small ints (`groups` in each asset's params
// JSON), but the group-state texture is one town-wide strip shared by every
// material. Once two assets share a batch, the second asset's re-used 0..N
// would lift and glow with the first's. So Blender keeps baking local ids and
// the pipeline remaps them to town-wide slots: the manifest is the registry,
// each record carrying its `groups` (name → slot), allocated under the
// manifest lock.
//
// Slots are stable, never renumbered while their name survives: existing
// names keep theirs, so unrelated assets' committed GLBs stay valid when one
// asset gains a group. A removed or renamed group's slot returns to the pool
// and the next new group reuses it, so renames don't leak slots.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MAX_GROUPS } from '../../src/groupSlots.ts'

const ROOT = resolve(import.meta.dirname, '../..')

/** Group name → global `uGroupState` slot. */
export type GroupTable = Record<string, number>
/** Asset (`<hood>/<object>`) → its group table. */
export type GroupRegistry = Record<string, GroupTable>

/** The local `_ID` per group name an asset's params file declares. */
export function assetLocalIds(asset: string): Record<string, number> {
  const params = JSON.parse(
    readFileSync(join(ROOT, 'assets/blender', `${asset}.json`), 'utf8'),
  ) as {
    groups?: Record<string, number>
  }
  return params.groups ?? {}
}

export interface SlotAllocation {
  /** Name → global slot, recorded in the manifest. */
  table: GroupTable
  /** Local `_ID` → global slot, applied by `pack`. */
  remap: Map<number, number>
}

/**
 * `asset`'s slots against the persistent `registry`. Existing names keep
 * theirs; removed names' slots return to the pool and the next new names
 * reuse them (smallest first) before minting fresh ones, so a rename swaps
 * its slot instead of leaking it. Throws past MAX_GROUPS: the town
 * outgrowing the group-state texture is D-032's cue to raise it (the texture
 * width and the shader keys follow automatically).
 */
export function allocateSlots(
  asset: string,
  localIds: Record<string, number>,
  registry: GroupRegistry,
): SlotAllocation {
  const ownTable = registry[asset] ?? {}
  // Reserved by other assets: the current asset's own old table is excluded,
  // so its freed slots are reusable rather than permanently marked used.
  const used = new Set<number>()
  for (const [name, table] of Object.entries(registry)) {
    if (name === asset) continue
    for (const slot of Object.values(table)) used.add(slot)
  }
  // Claim the slots this asset keeps first, so reuse and minting below can
  // never collide with them. Fail closed on a corrupted registry instead of
  // merging two groups into one slot.
  for (const name of Object.keys(localIds)) {
    const kept = ownTable[name]
    if (kept === undefined) continue
    if (used.has(kept))
      throw new Error(`slot ${kept} for ${asset} group "${name}" is already taken`)
    used.add(kept)
  }
  const freed = Object.entries(ownTable)
    .filter(([name]) => !(name in localIds))
    .map(([, slot]) => slot)
    .filter((slot) => !used.has(slot))
    .sort((a, b) => a - b)
  const table: GroupTable = {}
  const remap = new Map<number, number>()
  let next = 0
  const fresh = (): number => {
    while (used.has(next)) next += 1
    if (next >= MAX_GROUPS) {
      throw new Error(
        `no group slot left for ${asset} (MAX_GROUPS=${MAX_GROUPS}); ` +
          `the town outgrew the group-state texture — raise MAX_GROUPS (D-032)`,
      )
    }
    used.add(next)
    next += 1
    return next - 1
  }
  for (const name of Object.keys(localIds).sort()) {
    const local = localIds[name]
    if (local === undefined) throw new Error(`group "${name}" of ${asset} has no local _ID`)
    if (remap.has(local)) {
      throw new Error(`duplicate local _ID ${local} for ${asset} groups (one is "${name}")`)
    }
    const kept = ownTable[name]
    const reuse = freed.find((slot) => !used.has(slot))
    const slot = kept ?? reuse ?? fresh()
    if (slot !== kept) used.add(slot)
    table[name] = slot
    remap.set(local, slot)
  }
  return { table, remap }
}
