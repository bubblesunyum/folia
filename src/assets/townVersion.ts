// The town registry's live version, without the registry (fol-kes.14):
// `TownRegistry` binds its meshes map here on construction, so passes holding
// only the map (picking, the water mirror) can key their caches on the
// monotonic content version instead of rescanning every live instance per
// call. This module imports nothing at runtime — the `TownRegistry` import is
// type-only — so the picking core stays out of the prerender graph's runtime
// (D-047).

import type { TownRegistry } from './townRegistry'

/** Registry meshes map → its live owner, so map-only passes can read the content version. */
export const registryForMeshes = new WeakMap<object, TownRegistry>()

/**
 * The registry's monotonic content version for `meshes`, or undefined when
 * `meshes` is not a live town registry map (tests use plain maps and fall
 * back to the content fingerprint). Picking and the day mirror key their
 * caches on this instead of rescanning every live instance per call.
 */
export function versionForMeshes<K, V>(meshes: ReadonlyMap<K, V>): number | undefined {
  return registryForMeshes.get(meshes)?.version
}
