// Global group slots (fol-716, D-061).
//
// `_ID` values are per-asset small ints (`groups` in each asset's params
// JSON), but `uGroupState` is one global array shared by every material. Once
// two assets share a batch, the second asset's re-used 0..N would lift and
// glow with the first's. So Blender keeps baking local ids and the pipeline
// remaps them to town-wide slots: the manifest is the registry, each record
// carrying its `groups` (name → slot), allocated append-only under the
// manifest lock and never renumbered.

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
 * `asset`'s slots against the persistent `registry`. Names never seen get
 * fresh slots, append-only; existing names keep theirs, so unrelated assets'
 * committed GLBs stay valid when one asset gains a group (at the cost of a
 * leaked slot on rename). Throws past MAX_GROUPS: the town outgrowing the
 * uniform array is D-032's tiny-texture path.
 */
export function allocateSlots(
  asset: string,
  localIds: Record<string, number>,
  registry: GroupRegistry,
): SlotAllocation {
  const used = new Set(Object.values(registry).flatMap((table) => Object.values(table)))
  const table: GroupTable = {}
  const remap = new Map<number, number>()
  let next = 0
  const fresh = (): number => {
    while (used.has(next)) next += 1
    if (next >= MAX_GROUPS) {
      throw new Error(
        `no uGroupState slot left for ${asset} (MAX_GROUPS=${MAX_GROUPS}); ` +
          `the town outgrew the uniform array — see D-032's tiny-texture path`,
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
    const slot = registry[asset]?.[name] ?? fresh()
    table[name] = slot
    remap.set(local, slot)
  }
  return { table, remap }
}
