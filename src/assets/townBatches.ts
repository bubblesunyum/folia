// Town-wide batch capacity (D-032): one BatchedMesh per shared material for
// the whole town, sized from the manifest before any GLB loads, so assets only
// add geometry on the expected path. Nothing here touches three, so it runs in
// Node too; the provider in `scene/TownBatches.tsx` owns the meshes.

/** Asset → batch → baked triangles, from `assets/manifest.json`. */
export type ManifestTriangles = Readonly<Record<string, Readonly<Record<string, number>>>>

/**
 * Asset → batch → pack-time geometry counts, from `assets/manifest.json`
 * (fol-3w2). `vertices`/`indices` are absent on records packed before the
 * counts landed; those batches fall back to the triangle estimate.
 */
export interface ManifestBatchCounts {
  triangles: number
  vertices?: number
  indices?: number
}

/** Either legacy triangle totals or pack-time counts per batch. */
export type ManifestCounts = Readonly<
  Record<string, Readonly<Record<string, number | ManifestBatchCounts>>>
>

type ManifestPart = Readonly<Record<string, Readonly<Record<string, number>>>>

/**
 * Joins the `virtual:folia-assets` per-batch maps (fol-6po) into the
 * `ManifestCounts` shape `capacityFromManifest` sizes from. Triangles are the
 * source of truth for which batches exist; a batch gets exact counts only
 * when both vertices and indices are present, otherwise it stays a legacy
 * triangle total and falls back to the triangles×3 estimate.
 */
export function manifestCounts(
  triangles: ManifestPart,
  vertices: ManifestPart = {},
  indices: ManifestPart = {},
): ManifestCounts {
  return Object.fromEntries(
    Object.entries(triangles).map(([asset, batches]) => [
      asset,
      Object.fromEntries(
        Object.entries(batches).map(([batch, tris]) => {
          const v = vertices[asset]?.[batch]
          const i = indices[asset]?.[batch]
          return [
            batch,
            v === undefined || i === undefined
              ? tris
              : { triangles: tris, vertices: v, indices: i },
          ]
        }),
      ),
    ]),
  )
}

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
  manifest: ManifestCounts,
  headroom: { instances: number; vertices: number; indices: number } = CAPACITY_HEADROOM,
): Record<string, BatchCapacity> {
  const totals = new Map<
    string,
    { assets: number; tris: number; vertices: number; indices: number; exact: boolean }
  >()
  for (const batches of Object.values(manifest)) {
    for (const [batch, value] of Object.entries(batches)) {
      const counts: ManifestBatchCounts = typeof value === 'number' ? { triangles: value } : value
      const total = totals.get(batch) ?? {
        assets: 0,
        tris: 0,
        vertices: 0,
        indices: 0,
        exact: true,
      }
      total.assets += 1
      total.tris += counts.triangles
      if (counts.vertices === undefined || counts.indices === undefined) {
        // Legacy record (or a batch the pack step didn't count): keep the
        // pre-fol-3w2 triangles×3 estimate for the whole batch.
        total.exact = false
      } else {
        total.vertices += counts.vertices
        total.indices += counts.indices
      }
      totals.set(batch, total)
    }
  }
  return Object.fromEntries(
    // Exact counts already are vertices, so they still need the per-geometry
    // LOD reservation the registry adds at registration on top, then headroom
    // for breadth assets exactly like the triangle estimate.
    [...totals].map(([batch, total]) => [
      batch,
      {
        maxInstances: Math.max(MINIMUM.maxInstances, total.assets * headroom.instances),
        maxVertices: Math.max(
          MINIMUM.maxVertices,
          (total.exact ? total.vertices * LOD_RESERVE : total.tris * 3) * headroom.vertices,
        ),
        maxIndices: Math.max(
          MINIMUM.maxIndices,
          (total.exact ? total.indices * LOD_RESERVE : total.tris * 3) * headroom.indices,
        ),
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

// Town placement (fol-l7d.1): one file per neighborhood under `content/town/`
// (`<hood>.json` plus `river.json`) is the single source the Blender bake and
// the runtime both read. The bake assembles the skeleton in world space around
// these centres; the runtime applies them as offsets instead of assuming any
// asset sits at the origin. Pure and three-free like the rest of this module.

/** One hood's town placement: centre in metres (three XZ), yaw about +Y, pad radius. */
export interface HoodPlacement {
  hood: string
  centre: readonly [number, number]
  yaw: number
  radius: number
}

const HOOD_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function finiteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`town placement: ${what} is not a finite number`)
  }
  return value
}

/**
 * Parses one `content/town/<hood>.json` file. Fail closed on any drift: a
 * missing key, a bad slug, or a non-finite number throws instead of placing
 * a neighborhood nowhere.
 */
export function parseHoodPlacement(raw: unknown, file: string): HoodPlacement {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`town placement: ${file} is not an object`)
  }
  const { hood, centre, yaw, radius } = raw as Record<string, unknown>
  if (typeof hood !== 'string' || !HOOD_SLUG.test(hood)) {
    throw new Error(`town placement: ${file} has no valid hood slug`)
  }
  if (!Array.isArray(centre) || centre.length !== 2) {
    throw new Error(`town placement: ${file} centre is not an xz pair`)
  }
  const [x, z] = centre
  return {
    hood,
    centre: [finiteNumber(x, `${file} centre[0]`), finiteNumber(z, `${file} centre[1]`)],
    yaw: finiteNumber(yaw, `${file} yaw`),
    radius: finiteNumber(radius, `${file} radius`),
  }
}

/**
 * A hood's town offset in metres (three XYZ, y always 0): added to that
 * hood's baked-local spots, mirroring `applyPoolPlacement` for light pools.
 * Cortico's placement is the identity, so its pools ride untouched.
 */
export function hoodOffset(place: HoodPlacement): readonly [number, number, number] {
  return [place.centre[0], 0, place.centre[1]]
}
