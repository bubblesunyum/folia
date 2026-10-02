// Per-group invisible hit volumes for hover/click picking (D-021, fol-hft).
//
// `pickSlot.ts` used to sweep `raycaster.intersectObjects` over every town
// BatchedMesh on each pointer move and click: exact, but linear in the
// town's triangles (~177k and growing with breadth). These volumes flip the
// cost: one ray-vs-box test per group slot, then triangle tests only inside
// the volumes the ray actually enters. A pick scales with the hit group's
// triangles, not the town's.
//
// Pure core, three-free on purpose: geometry arrives as callbacks and the ray
// as plain tuples, so the math tests without a renderer and `three` stays out
// of the prerender graph's runtime (D-047). The R3F rigs own the raycaster;
// everything here is plain math with tests.

import { slotFromGroupId } from './hover'

/** Batch names that never become hit volumes: redraws of another batch's geometry. */
const EXCLUDED_BATCHES: ReadonlySet<string> = new Set([
  // The additive neon glow shell redraws `neon`'s geometry: it can only double
  // pick cost, never resolve a new slot.
  'neonGlow',
])

/** Whether `batch` contributes hit volumes (false for the glow shell). */
export function isPickableBatch(batch: string): boolean {
  return !EXCLUDED_BATCHES.has(batch)
}

export type Vec3 = readonly [number, number, number]

/** One batch's world-space geometry as callbacks: no three types cross here. */
export interface HitVolumeSource {
  batch: string
  vertexCount: number
  /** Index positions (3 per triangle); falls back to vertexCount when unknown. */
  indexCount: number
  positionAt: (vertex: number) => Vec3
  groupAt: (vertex: number) => number | undefined
  /** Null for non-indexed geometry: triangle t uses vertices 3t, 3t+1, 3t+2. */
  indexAt: ((index: number) => number) | null
}

/** One group slot's invisible hit volume: its bounds plus triangle soup. */
export interface HitVolume {
  slot: number
  min: Vec3
  max: Vec3
  /** World-space triangle soup, 9 floats per triangle. */
  tris: Float32Array
  /** Triangles in the soup. */
  triangles: number
}

/** Squared area under which a triangle is zero-fill, not geometry. */
const DEGENERATE_EPS = 1e-20

function pushTri(out: number[], pa: Vec3, pb: Vec3, pc: Vec3): boolean {
  const abx = pb[0] - pa[0]
  const aby = pb[1] - pa[1]
  const abz = pb[2] - pa[2]
  const acx = pc[0] - pa[0]
  const acy = pc[1] - pa[1]
  const acz = pc[2] - pa[2]
  // |ab × ac|²: the reserved zero-fill reads as exactly 0 and is skipped.
  const cx = aby * acz - abz * acy
  const cy = abz * acx - abx * acz
  const cz = abx * acy - aby * acx
  if (cx * cx + cy * cy + cz * cz <= DEGENERATE_EPS) return false
  out.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2])
  return true
}

/**
 * Bucket every batch's triangles by group slot. Excluded batches never become
 * volumes; triangles with no slot (NaN groupId) or no area are skipped. The
 * slot reads off each triangle's first vertex, the same contract as the old
 * `hit.face.a` read, so hover addresses the same groups as before.
 */
export function buildHitVolumes(sources: Iterable<HitVolumeSource>): Map<number, HitVolume> {
  const soup = new Map<number, number[]>()
  for (const source of sources) {
    if (!isPickableBatch(source.batch)) continue
    const count = Number.isFinite(source.indexCount) ? source.indexCount : source.vertexCount
    const triangles = Math.floor(count / 3)
    for (let t = 0; t < triangles; t += 1) {
      const a = source.indexAt ? source.indexAt(t * 3) : t * 3
      const b = source.indexAt ? source.indexAt(t * 3 + 1) : t * 3 + 1
      const c = source.indexAt ? source.indexAt(t * 3 + 2) : t * 3 + 2
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        !Number.isInteger(c) ||
        a < 0 ||
        b < 0 ||
        c < 0 ||
        a >= source.vertexCount ||
        b >= source.vertexCount ||
        c >= source.vertexCount
      ) {
        continue
      }
      const slot = slotFromGroupId(source.groupAt, a)
      if (slot === null) continue
      let list = soup.get(slot)
      if (!list) {
        list = []
        soup.set(slot, list)
      }
      pushTri(list, source.positionAt(a), source.positionAt(b), source.positionAt(c))
    }
  }
  const volumes = new Map<number, HitVolume>()
  for (const [slot, flat] of soup) {
    if (flat.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < flat.length; i += 3) {
      const x = flat[i] ?? 0
      const y = flat[i + 1] ?? 0
      const z = flat[i + 2] ?? 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
    volumes.set(slot, {
      slot,
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      tris: new Float32Array(flat),
      triangles: flat.length / 9,
    })
  }
  return volumes
}

/** Ray-vs-box entry distance (0 when the origin sits inside), or null on a miss. */
export function rayBoxEntry(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3): number | null {
  let entry = -Infinity
  let exit = Infinity
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis] ?? 0
    const d = direction[axis] ?? 0
    const lo = min[axis] ?? 0
    const hi = max[axis] ?? 0
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    const t0 = (lo - o) / d
    const t1 = (hi - o) / d
    const near = Math.min(t0, t1)
    const far = Math.max(t0, t1)
    if (near > entry) entry = near
    if (far < exit) exit = far
    if (entry > exit) return null
  }
  if (exit < 0) return null
  return Math.max(entry, 0)
}

const TRI_EPS = 1e-9

function rayTri(
  origin: Vec3,
  direction: Vec3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number | null {
  // Möller–Trumbore, double-sided: hover forgives backfaces (open shells,
  // single-quad proxies) where the old front-face read stayed silent.
  const e1x = bx - ax
  const e1y = by - ay
  const e1z = bz - az
  const e2x = cx - ax
  const e2y = cy - ay
  const e2z = cz - az
  const dx = direction[0] ?? 0
  const dy = direction[1] ?? 0
  const dz = direction[2] ?? 0
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < TRI_EPS) return null
  const inv = 1 / det
  const sx = (origin[0] ?? 0) - ax
  const sy = (origin[1] ?? 0) - ay
  const sz = (origin[2] ?? 0) - az
  const u = (sx * px + sy * py + sz * pz) * inv
  if (u < 0 || u > 1) return null
  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return null
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t > TRI_EPS ? t : null
}

function raySoup(origin: Vec3, direction: Vec3, tris: Float32Array, best: number): number | null {
  let hit: number | null = null
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const t = rayTri(
      origin,
      direction,
      tris[i] ?? 0,
      tris[i + 1] ?? 0,
      tris[i + 2] ?? 0,
      tris[i + 3] ?? 0,
      tris[i + 4] ?? 0,
      tris[i + 5] ?? 0,
      tris[i + 6] ?? 0,
      tris[i + 7] ?? 0,
      tris[i + 8] ?? 0,
    )
    if (t !== null && t < best && (hit === null || t < hit)) hit = t
  }
  return hit
}

/**
 * The slot under the ray, or null on a miss. Volumes sort by box entry and
 * the search stops once boxes start past the nearest triangle hit, so a pick
 * tests the entered groups' triangles — never the town's.
 */
export function pickHitVolume(
  volumes: ReadonlyMap<number, HitVolume>,
  origin: Vec3,
  direction: Vec3,
): number | null {
  const ordered: { slot: number; entry: number }[] = []
  for (const volume of volumes.values()) {
    const entry = rayBoxEntry(origin, direction, volume.min, volume.max)
    if (entry !== null) ordered.push({ slot: volume.slot, entry })
  }
  ordered.sort((a, b) => a.entry - b.entry)
  let bestSlot: number | null = null
  let best = Infinity
  for (const { slot, entry } of ordered) {
    if (entry > best) break
    const volume = volumes.get(slot)
    if (!volume) continue
    const hit = raySoup(origin, direction, volume.tris, best)
    if (hit !== null && hit < best) {
      best = hit
      bestSlot = slot
    }
  }
  return bestSlot
}
