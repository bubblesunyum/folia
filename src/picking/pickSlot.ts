// Raycast → slot picking shared by the hover and pedestal rigs (fol-8z6,
// fol-hft). Picks against per-group invisible hit volumes (D-021) instead of
// sweeping `raycaster.intersectObjects` over every town BatchedMesh: one
// ray-vs-box test per slot, then triangle tests only inside the volumes the
// ray enters. A pick scales with the hit group's triangles, not the town's —
// the ~177k-tri sweep on each pointer move is gone. The additive neon glow
// shell is excluded: it redraws `neon`'s geometry, so it can only double
// cost, never resolve a new slot.
//
// The volumes enumerate live instances the way `BatchedMesh.raycast` does
// (fol-kes.5): per instance, hidden instances are skipped (`getVisibleAt`)
// and deleted ones never surface (`getVisibleAt` / `getGeometryIdAt` /
// `getMatrixAt` / `getGeometryRangeAt` throw on inactive ids, the same
// validation the raycast relies on). Each instance contributes only its own
// geometry draw range — never the whole buffer — so an asset unmounted
// without `optimize()` (the `TownRegistry.unregister` norm) leaves no
// pickable ghost behind. Vertices ride the instance matrix premultiplied by
// the batch `matrixWorld`, the raycast's exact transform order.
//
// The volumes cache rebuilds only when the content fingerprint moves (mesh
// identity, live/hidden instance states, instance matrices, geometry ranges,
// batch transform, attribute versions or sizes), so steady hovers pay the
// query alone. three imports are type-only (erased at build), so this stays
// out of the prerender graph's runtime (D-047): matrices cross as plain
// 16-float column-major arrays through a duck-typed `fromArray` sink, never
// a `Matrix4`.

import type { BatchedMesh, Camera, Raycaster, Vector2 } from 'three'
import {
  buildHitVolumes,
  type HitVolume,
  type HitVolumeSource,
  isPickableBatch,
  pickHitVolume,
  type Vec3,
} from './hitVolumes'
import { recordPick, recordRebuild } from './pickStats'

interface VolumeCache {
  key: string
  volumes: ReadonlyMap<number, HitVolume>
}

let cache: VolumeCache | null = null

/** Highest live slot seen + 1, per batch mesh: freed ids reuse low, appends grow. Reset with the cache. */
let scanBounds = new WeakMap<object, number>()

/** Drops the cached volumes and the per-mesh scan bounds: tests reset here. */
export function clearPickCache(): void {
  cache = null
  scanBounds = new WeakMap()
}

/** Duck-typed `Matrix4` target: `getMatrixAt` only ever calls `fromArray`. */
interface MatrixSink {
  fromArray(data: ArrayLike<number>, offset?: number): unknown
}

/**
 * The public `BatchedMesh` surface picking reads: validate-on-read liveness
 * (the getters throw on deleted ids), capacity for the scan bound, and the
 * batch transform. No privates, no three runtime: matrices cross as element
 * arrays, so the prerender graph never gains a three import (D-047).
 */
interface PickMesh {
  readonly instanceCount: number
  readonly maxInstanceCount: number
  readonly matrixWorld?: { readonly elements?: ArrayLike<number> } | null | undefined
  getVisibleAt(instanceId: number): boolean
  getGeometryIdAt(instanceId: number): number
  getMatrixAt(instanceId: number, target: MatrixSink): unknown
  getGeometryRangeAt(geometryId: number): { start: number; count: number }
}

/** One live instance slot: the raycast's per-instance state, minus the mesh. */
interface SlotRead {
  slot: number
  visible: boolean
  gid: number | null
  matrixHash: number | null
  start: number
  count: number
}

/** Instance matrix as 16 column-major floats, or null when the id is dead. */
function readMatrix(mesh: PickMesh, instanceId: number): number[] | null {
  const out = new Array<number>(16).fill(0)
  const sink: MatrixSink = {
    fromArray: (data, offset = 0) => {
      for (let i = 0; i < 16; i += 1) out[i] = data[offset + i] ?? 0
      return undefined
    },
  }
  try {
    mesh.getMatrixAt(instanceId, sink)
  } catch {
    return null
  }
  return out
}

/**
 * Batch transform premultiplied onto the instance matrix: the raycast's
 * `getMatrixAt(i, m).premultiply(matrixWorld)` order. Identity when the batch
 * carries no transform.
 */
function toWorldMatrix(mesh: PickMesh, local: readonly number[]): number[] {
  const elements = mesh.matrixWorld?.elements
  if (!elements || elements.length < 16) return [...local]
  const world = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) {
        sum += (elements[row + k * 4] ?? 0) * (local[k + column * 4] ?? 0)
      }
      world[row + column * 4] = sum
    }
  }
  return world
}

/** `Vector3.applyMatrix4` on a column-major 4x4, no three import. */
function transformPoint(matrix: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  const m0 = matrix[0] ?? 0
  const m1 = matrix[1] ?? 0
  const m2 = matrix[2] ?? 0
  const m3 = matrix[3] ?? 0
  const m4 = matrix[4] ?? 0
  const m5 = matrix[5] ?? 0
  const m6 = matrix[6] ?? 0
  const m7 = matrix[7] ?? 0
  const m8 = matrix[8] ?? 0
  const m9 = matrix[9] ?? 0
  const m10 = matrix[10] ?? 0
  const m11 = matrix[11] ?? 0
  const m12 = matrix[12] ?? 0
  const m13 = matrix[13] ?? 0
  const m14 = matrix[14] ?? 0
  const m15 = matrix[15] ?? 0
  const w = m3 * x + m7 * y + m11 * z + m15
  let nx = m0 * x + m4 * y + m8 * z + m12
  let ny = m1 * x + m5 * y + m9 * z + m13
  let nz = m2 * x + m6 * y + m10 * z + m14
  if (w !== 0 && w !== 1) {
    nx /= w
    ny /= w
    nz /= w
  }
  return [nx, ny, nz]
}

const floatBits = new Float64Array(1)
const intBits = new Int32Array(floatBits.buffer)

/** Exact 32-bit hash of one float's bits: no float formatting in fingerprints. */
function hashFloat(hash: number, value: number): number {
  floatBits[0] = value
  hash = Math.imul(hash ^ (intBits[0] ?? 0), 2654435761)
  hash = Math.imul(hash ^ (intBits[1] ?? 0), 2654435761)
  return hash | 0
}

/** Exact hash of 16 column-major floats. */
function hashMatrix16(matrix: ArrayLike<number>): number {
  let hash = 2166136261
  for (let i = 0; i < 16; i += 1) hash = hashFloat(hash, matrix[i] ?? 0)
  return hash | 0
}

/**
 * Live instance slots in `[from, to)`: a throw means deleted, so the slot is
 * simply absent. Never-allocated ids past the high-water mark throw the same
 * way and are absent too.
 */
function scanSlots(mesh: PickMesh, from: number, to: number): SlotRead[] {
  const reads: SlotRead[] = []
  for (let slot = from; slot < to; slot += 1) {
    let visible: boolean
    try {
      visible = mesh.getVisibleAt(slot)
    } catch {
      continue
    }
    let gid: number | null = null
    try {
      gid = mesh.getGeometryIdAt(slot)
    } catch {
      gid = null
    }
    const elements = readMatrix(mesh, slot)
    let start = -1
    let count = 0
    if (gid !== null) {
      try {
        const range = mesh.getGeometryRangeAt(gid)
        start = range.start
        count = range.count
      } catch {
        start = -1
        count = 0
      }
    }
    reads.push({
      slot,
      visible,
      gid,
      matrixHash: elements ? hashMatrix16(elements) : null,
      start,
      count,
    })
  }
  return reads
}

/**
 * Every live slot, ascending. The fast path probes only the cached bound; it
 * is complete exactly when the live tally matches `instanceCount` (hidden
 * instances count as live here), so a wider scan runs only after appends
 * past the bound — a fingerprint miss either way, after which the bound
 * heals to the new top.
 */
function liveSlots(mesh: PickMesh): SlotRead[] {
  const capacity = Math.max(mesh.maxInstanceCount, 0)
  const bound = Math.min(Math.max(scanBounds.get(mesh) ?? capacity, 0), capacity)
  const reads = scanSlots(mesh, 0, bound)
  if (reads.length !== mesh.instanceCount && bound < capacity) {
    reads.push(...scanSlots(mesh, bound, capacity))
  }
  let top = 0
  for (const read of reads) top = Math.max(top, read.slot + 1)
  scanBounds.set(mesh, top)
  return reads
}

/**
 * Content fingerprint: any register/unregister/grow/compact moves it, and so
 * does any visibility flip, matrix edit, geometry-range move or batch
 * transform — while steady hovers keep the key (and the volumes) untouched.
 */
/** Attribute version for the fingerprint: interleaved attributes carry no version, so fall back to -1 (every content write bumps the mesh another way). */
function versionOf(attr: unknown): number {
  if (typeof attr === 'object' && attr !== null && 'version' in attr) {
    const version: unknown = (attr as { version: unknown }).version
    if (typeof version === 'number') return version
  }
  return -1
}

function fingerprint(meshes: ReadonlyMap<string, BatchedMesh>): string {
  const parts: string[] = []
  for (const [name, mesh] of meshes) {
    const pickMesh = mesh as unknown as PickMesh
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const group = geometry.getAttribute('groupId')
    parts.push(
      [
        name,
        pickMesh.instanceCount,
        pickMesh.maxInstanceCount,
        position?.count ?? -1,
        versionOf(position),
        index?.count ?? -1,
        versionOf(index),
        versionOf(group),
      ].join(':'),
    )
    const slots = liveSlots(pickMesh)
      .map((read) =>
        [
          read.slot,
          read.visible ? 1 : 0,
          read.gid ?? -1,
          read.matrixHash ?? 0,
          read.start,
          read.count,
        ].join(','),
      )
      .join(';')
    const elements = pickMesh.matrixWorld?.elements
    parts.push(`${slots}|${elements ? hashMatrix16(elements) : 'id'}`)
  }
  return parts.join('|')
}

/**
 * One batch mesh as volume sources: one per live, visible instance, clipped
 * to its geometry draw range with vertices lifted to world space. Throws on a
 * missing group channel: fail closed.
 */
function sourcesFor(name: string, mesh: BatchedMesh): HitVolumeSource[] {
  if (!isPickableBatch(name)) return []
  const pickMesh = mesh as unknown as PickMesh
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const group = geometry.getAttribute('groupId')
  if (!position) throw new Error(`picking: batch "${name}" has no position attribute`)
  if (!group) throw new Error('picking: batch has no groupId attribute')
  const index = geometry.getIndex()
  const groupAt = (vertex: number): number => group.getX(vertex)
  const sources: HitVolumeSource[] = []
  for (const read of liveSlots(pickMesh)) {
    if (!read.visible || read.gid === null || read.count <= 0 || read.start < 0) continue
    const local = readMatrix(pickMesh, read.slot)
    if (!local) continue
    const world = toWorldMatrix(pickMesh, local)
    const { start, count } = read
    const positionAt = (vertex: number): Vec3 =>
      transformPoint(world, position.getX(vertex), position.getY(vertex), position.getZ(vertex))
    // Non-indexed ranges can start past zero: map the range explicitly, since
    // a null indexAt would read vertices 3t.. from the buffer start.
    const indexAt = index
      ? (at: number): number => index.getX(start + at)
      : (at: number): number => start + at
    sources.push({
      batch: name,
      vertexCount: position.count,
      indexCount: count,
      positionAt,
      groupAt,
      indexAt,
    })
  }
  return sources
}

function volumesFor(meshes: ReadonlyMap<string, BatchedMesh>): ReadonlyMap<number, HitVolume> {
  const key = fingerprint(meshes)
  if (!cache || cache.key !== key) {
    const started = performance.now()
    const sources: HitVolumeSource[] = []
    for (const [name, mesh] of meshes) {
      sources.push(...sourcesFor(name, mesh))
    }
    const volumes = buildHitVolumes(sources)
    let triangles = 0
    for (const volume of volumes.values()) triangles += volume.triangles
    cache = { key, volumes }
    recordRebuild(performance.now() - started, volumes.size, triangles)
  }
  return cache.volumes
}

/**
 * Pick the slot under `pointer` against the per-group hit volumes — today's
 * contract in both rigs, kept verbatim. Callers set the pointer from the
 * event (NDC) before the frame consumes it. Returns null on a miss; throws
 * on a missing group channel: fail closed, never hover or open the whole
 * town on a missing attribute.
 */
export function pickSlotFromHit(
  meshes: ReadonlyMap<string, BatchedMesh>,
  raycaster: Raycaster,
  pointer: Vector2,
  camera: Camera,
): number | null {
  raycaster.setFromCamera(pointer, camera)
  const volumes = volumesFor(meshes)
  const { origin, direction } = raycaster.ray
  const started = performance.now()
  const slot = pickHitVolume(
    volumes,
    [origin.x, origin.y, origin.z],
    [direction.x, direction.y, direction.z],
  )
  recordPick(performance.now() - started)
  return slot
}
