// Town-wide batch capacity (D-032): one BatchedMesh per shared material for
// the whole town, sized from the manifest before any GLB loads, so assets only
// add geometry on the expected path. Nothing here touches three, so it runs in
// Node too; the provider in `scene/TownBatches.tsx` owns the meshes.

/** Asset → batch → baked triangles, from `assets/manifest.json`. */
export type ManifestTriangles = Readonly<Record<string, Readonly<Record<string, number>>>>

export interface BatchCapacity {
  maxInstances: number
  maxVertices: number
  maxIndices: number
}

/**
 * Provisional headroom until breadth measures the real town. Instances are
 * cheap (one matrix each) and scale with asset count, so they get the most;
 * vertices carry the VRAM. The fragment's cream is ~108k tris; 4x holds a few
 * fragment-sized assets and growth doubles from there.
 */
export const CAPACITY_HEADROOM = { instances: 16, vertices: 4, indices: 4 } as const

/**
 * Per-geometry vertex/index reservation for a future hi-LOD swap through
 * `setGeometryAt` (C-2): the swap never reallocates because the larger LOD
 * already fits. 2x is a placeholder until breadth brings real LOD sizes.
 */
export const LOD_RESERVE = 2

const MINIMUM: BatchCapacity = { maxInstances: 8, maxVertices: 1024, maxIndices: 1024 }

/** Floor for batches with no manifest entry yet (breadth assets, new materials). */
export const MINIMUM_BATCH_CAPACITY: BatchCapacity = { ...MINIMUM }

/** Town-wide capacity per batch: manifest totals times headroom. */
export function capacityFromManifest(
  triangles: ManifestTriangles,
  headroom: { instances: number; vertices: number; indices: number } = CAPACITY_HEADROOM,
): Record<string, BatchCapacity> {
  const totals = new Map<string, { assets: number; tris: number }>()
  for (const batches of Object.values(triangles)) {
    for (const [batch, tris] of Object.entries(batches)) {
      const total = totals.get(batch) ?? { assets: 0, tris: 0 }
      total.assets += 1
      total.tris += tris
      totals.set(batch, total)
    }
  }
  return Object.fromEntries(
    [...totals].map(([batch, { assets, tris }]) => [
      batch,
      {
        maxInstances: Math.max(MINIMUM.maxInstances, assets * headroom.instances),
        maxVertices: Math.max(MINIMUM.maxVertices, tris * 3 * headroom.vertices),
        maxIndices: Math.max(MINIMUM.maxIndices, tris * 3 * headroom.indices),
      },
    ]),
  )
}

/**
 * Derived batches (`neonGlow` drawn from `neon`'s geometry) need the same room
 * as their source; the manifest only lists baked batches.
 */
export function withDerivedCapacity(
  capacities: Record<string, BatchCapacity>,
  derived: Readonly<Record<string, string>>,
): Record<string, BatchCapacity> {
  const out = { ...capacities }
  for (const [batch, source] of Object.entries(derived)) {
    const cap = out[source]
    if (cap) out[batch] = { ...cap }
  }
  return out
}

/** Double every axis: the overflow and hot-swap-compaction path. */
export function grownCapacity(capacity: BatchCapacity): BatchCapacity {
  return {
    maxInstances: capacity.maxInstances * 2,
    maxVertices: capacity.maxVertices * 2,
    maxIndices: capacity.maxIndices * 2,
  }
}
