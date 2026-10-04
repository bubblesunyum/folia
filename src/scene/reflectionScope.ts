import { type BatchedMesh, Box3, Matrix4 } from 'three'

/** Public BatchedMesh operations used to inspect live instance geometry. */
export interface ReflectionBatch
  extends Pick<
    BatchedMesh,
    | 'instanceCount'
    | 'maxInstanceCount'
    | 'matrixWorld'
    | 'visible'
    | 'getVisibleAt'
    | 'getGeometryIdAt'
    | 'getMatrixAt'
    | 'getBoundingBoxAt'
    | 'setVisibleAt'
  > {}

export interface ReflectionScopeScratch {
  instance: Matrix4
  world: Matrix4
  geometryBounds: Box3
  instanceBounds: Box3
  hidden: { batch: ReflectionBatch; id: number }[]
  hiddenCount: number
}

export function createReflectionScopeScratch(): ReflectionScopeScratch {
  return {
    instance: new Matrix4(),
    world: new Matrix4(),
    geometryBounds: new Box3(),
    instanceBounds: new Box3(),
    hidden: [],
    hiddenCount: 0,
  }
}

// BatchedMesh exposes liveness through its public getters, which throw for
// deleted or never-allocated ids. Keep the last live high-water mark and only
// scan farther when instanceCount proves an append happened beyond it.
const scanBounds = new WeakMap<ReflectionBatch, number>()

/** Visit live instance bounds in world space, reusing the supplied Box3. */
export function forEachReflectionInstance<T>(
  batch: ReflectionBatch,
  scratch: ReflectionScopeScratch,
  visit: (id: number, visible: boolean, bounds: Box3 | null) => T,
): void {
  const capacity = Math.max(0, batch.maxInstanceCount)
  const knownBound = Math.min(scanBounds.get(batch) ?? 0, capacity)
  let live = 0
  let top = 0

  const scan = (start: number, end: number) => {
    for (let id = start; id < end; id += 1) {
      let visible: boolean
      try {
        visible = batch.getVisibleAt(id)
      } catch {
        continue
      }
      live += 1
      top = id + 1
      if (!visible) {
        visit(id, false, null)
        continue
      }

      let bounds: Box3 | null = null
      try {
        const geometryId = batch.getGeometryIdAt(id)
        const geometryBounds = batch.getBoundingBoxAt(geometryId, scratch.geometryBounds)
        if (geometryBounds) {
          batch.getMatrixAt(id, scratch.instance)
          scratch.world.multiplyMatrices(batch.matrixWorld, scratch.instance)
          bounds = scratch.instanceBounds.copy(geometryBounds).applyMatrix4(scratch.world)
        }
      } catch {
        // A deleted geometry or stale id has no safe spatial claim.
      }
      visit(id, true, bounds)
    }
  }

  scan(0, knownBound)
  if (live !== batch.instanceCount && knownBound < capacity) scan(knownBound, capacity)
  scanBounds.set(batch, top)
}

/**
 * Hide visible instances outside every pond's local neighborhood for one
 * day-reflection draw. Geometry and transforms come from the live batch data;
 * the caller restores materials and renderer state in its draw callback.
 */
export function withDayReflectionScope<T>(
  batches: Iterable<ReflectionBatch>,
  ponds: readonly Box3[],
  margin: number,
  scratch: ReflectionScopeScratch,
  draw: () => T,
  pondCount = ponds.length,
): T {
  scratch.hiddenCount = 0
  const nearBounds = scratch.geometryBounds
  try {
    for (const batch of batches) {
      if (!batch.visible) continue
      forEachReflectionInstance(batch, scratch, (id, visible, bounds) => {
        if (!visible) return
        let near = false
        if (bounds) {
          for (let pondIndex = 0; pondIndex < pondCount; pondIndex += 1) {
            const pond = ponds[pondIndex]
            if (!pond) continue
            nearBounds.copy(pond)
            nearBounds.min.x -= margin
            nearBounds.max.x += margin
            nearBounds.min.z -= margin
            nearBounds.max.z += margin
            if (
              bounds.max.x >= nearBounds.min.x &&
              bounds.min.x <= nearBounds.max.x &&
              bounds.max.z >= nearBounds.min.z &&
              bounds.min.z <= nearBounds.max.z
            ) {
              near = true
              break
            }
          }
        }
        if (!near) {
          batch.setVisibleAt(id, false)
          const index = scratch.hiddenCount
          scratch.hiddenCount += 1
          const entry = scratch.hidden[index]
          if (entry) {
            entry.batch = batch
            entry.id = id
          } else {
            scratch.hidden.push({ batch, id })
          }
        }
      })
    }
    return draw()
  } finally {
    for (let i = 0; i < scratch.hiddenCount; i += 1) {
      const entry = scratch.hidden[i]
      if (!entry) continue
      try {
        // Only visible instances were changed, so restoring true preserves
        // each source visibility state and safely ignores deleted ids.
        entry.batch.setVisibleAt(entry.id, true)
      } catch {
        // If an instance was deleted during the draw, it must stay deleted.
      }
    }
  }
}
