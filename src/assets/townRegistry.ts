// The town batch registry, framework-free (D-032): one BatchedMesh per shared
// material for the whole town. Assets add their dequantized geometries and
// remove them on unmount; LOD swaps ride `setGeometryAt` inside the
// per-geometry reservation, so they never reallocate. Overflow compacts the
// mesh and retries, doubling and migrating only when live content truly
// exceeds capacity, so deletes never ratchet capacity upward.
// The React provider in `scene/TownBatches.tsx` is a thin rig over this.

import type { BatchedMesh, BufferGeometry } from 'three'
import { type BatchCapacity, grownCapacity, LOD_RESERVE } from './townBatches'

/** Batch → the asset's geometries for it. */
export type TownGeometries = ReadonlyMap<string, readonly BufferGeometry[]>

export interface MeshHandles {
  gid: number
  iid: number
}

/** Builds one town mesh; throws for a batch with no shared material. */
export type MeshFactory = (batch: string, capacity: BatchCapacity) => BatchedMesh

/** One geometry as an identity instance, with room reserved for its hi-LOD. */
function addReservedInstance(mesh: BatchedMesh, geometry: BufferGeometry): MeshHandles {
  const vertices = (geometry.attributes.position?.count ?? 0) * LOD_RESERVE
  const index = geometry.getIndex()
  const gid = mesh.addGeometry(geometry, vertices, index ? index.count * LOD_RESERVE : -1)
  return { gid, iid: mesh.addInstance(gid) }
}

/**
 * The whole list or nothing: a failure removes what this call added before
 * rethrowing, so a half-added batch never lingers.
 */
function addBatchGeometries(mesh: BatchedMesh, list: readonly BufferGeometry[]): MeshHandles[] {
  const handles: MeshHandles[] = []
  try {
    for (const geometry of list) handles.push(addReservedInstance(mesh, geometry))
    return handles
  } catch (error) {
    for (const { iid } of handles) mesh.deleteInstance(iid)
    for (const { gid } of handles) mesh.deleteGeometry(gid)
    throw error
  }
}

/** True when `error` is a BatchedMesh running out of room, as opposed to a geometry breaking the batch schema. */
function isCapacityError(error: unknown): boolean {
  return error instanceof Error && /maximum|exceeds/i.test(error.message)
}

export class TownRegistry {
  readonly meshes = new Map<string, BatchedMesh>()
  private readonly capacities = new Map<string, BatchCapacity>()
  private readonly sources = new Map<string, Map<string, readonly BufferGeometry[]>>()
  private readonly handles = new Map<string, Map<string, MeshHandles[]>>()
  private retired: BatchedMesh[] = []
  /** Bumped on every content change. */
  version = 0

  constructor(
    capacities: ReadonlyMap<string, BatchCapacity>,
    private readonly factory: MeshFactory,
    private readonly onGrow?: () => void,
  ) {
    for (const [batch, cap] of capacities) {
      this.meshes.set(batch, factory(batch, cap))
      this.capacities.set(batch, cap)
    }
  }

  register(asset: string, geometries: TownGeometries): void {
    for (const batch of geometries.keys()) {
      if (!this.meshes.has(batch)) throw new Error(`no shared material for batch "${batch}"`)
    }
    // Replace semantics: a hot swap or StrictMode remount re-registers.
    this.unregister(asset)
    // Handles stay local until the whole asset succeeds, so a failure in a
    // later batch rolls back the earlier ones instead of ghosting them.
    const sources = new Map<string, readonly BufferGeometry[]>()
    const handles = new Map<string, MeshHandles[]>()
    try {
      for (const [batch, list] of geometries) {
        handles.set(batch, this.addWithGrowth(batch, list))
        sources.set(batch, list)
      }
    } catch (error) {
      this.rollback(handles)
      throw error
    }
    this.sources.set(asset, sources)
    this.handles.set(asset, handles)
  }

  unregister(asset: string): void {
    const record = this.handles.get(asset)
    if (!record) return
    for (const [batch, handles] of record) {
      const mesh = this.meshes.get(batch)
      if (!mesh) continue
      for (const { iid } of handles) mesh.deleteInstance(iid)
      for (const { gid } of handles) mesh.deleteGeometry(gid)
      this.touch(batch)
    }
    this.handles.delete(asset)
    this.sources.delete(asset)
  }

  /** Meshes replaced by growth, not yet disposed: the owner disposes them once the new mesh has committed. */
  drainRetired(): BatchedMesh[] {
    const dead = this.retired
    this.retired = []
    return dead
  }

  /**
   * Whether `asset` currently contributes geometries (fol-kes.4): gates that
   * read one owner's presence, never batch names — a batch shared by several
   * assets says nothing about which of them registered.
   */
  has(asset: string): boolean {
    return this.sources.has(asset)
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose()
    for (const mesh of this.drainRetired()) mesh.dispose()
  }

  private addWithGrowth(batch: string, list: readonly BufferGeometry[]): MeshHandles[] {
    let compacted = false
    for (;;) {
      const mesh = this.meshes.get(batch)
      if (!mesh) throw new Error(`no town batch "${batch}"`)
      try {
        const handles = addBatchGeometries(mesh, list)
        this.touch(batch)
        return handles
      } catch (error) {
        // Anything but overflow stays a throw, fail closed.
        if (!isCapacityError(error)) throw error
        // Deletes leave holes the bump allocator cannot reuse: compact and
        // retry so freed ranges are reused, and only double when live
        // content truly exceeds capacity.
        if (!compacted) {
          compacted = true
          mesh.optimize()
          continue
        }
        this.grow(batch)
      }
    }
  }

  private grow(batch: string): void {
    const old = this.meshes.get(batch)
    const cap = this.capacities.get(batch)
    if (!old || !cap) throw new Error(`no town batch "${batch}"`)
    const grown = grownCapacity(cap)
    const next = this.factory(batch, grown)
    for (const [asset, batches] of this.sources) {
      const list = batches.get(batch)
      if (!list) continue
      // Doubled capacity always fits what the old mesh held.
      this.handles.get(asset)?.set(batch, addBatchGeometries(next, list))
    }
    this.retired.push(old)
    this.meshes.set(batch, next)
    this.capacities.set(batch, grown)
    this.touch(batch)
    this.onGrow?.()
  }

  private rollback(handles: ReadonlyMap<string, MeshHandles[]>): void {
    for (const [batch, list] of handles) {
      const mesh = this.meshes.get(batch)
      if (!mesh) continue
      for (const { iid } of list) mesh.deleteInstance(iid)
      for (const { gid } of list) mesh.deleteGeometry(gid)
      this.touch(batch)
    }
  }

  /** Content changed: refresh whole-mesh bounds so frustum culling and the water plane track what is actually in the mesh. */
  private touch(batch: string): void {
    const mesh = this.meshes.get(batch)
    if (!mesh) return
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
    this.version += 1
  }
}
