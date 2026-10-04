import { BatchedMesh, Box3, BoxGeometry, Matrix4, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReflectionScopeScratch,
  forEachReflectionInstance,
  withDayReflectionScope,
} from './reflectionScope'

const geometry = new BoxGeometry(1, 1, 1)
const meshes: BatchedMesh[] = []

function batch(capacity = 8) {
  const mesh = new BatchedMesh(capacity, capacity * 8, capacity * 36)
  meshes.push(mesh)
  const geometryId = mesh.addGeometry(geometry)
  return {
    mesh,
    addAt(x: number, z: number) {
      const id = mesh.addInstance(geometryId)
      mesh.setMatrixAt(id, new Matrix4().makeTranslation(x, 0, z))
      return id
    },
  }
}

afterEach(() => {
  for (const mesh of meshes.splice(0)) mesh.dispose()
})

describe('day reflection instance scope', () => {
  const pond = [new Box3(new Vector3(-1, 0, -1), new Vector3(1, 0, 1))]

  it('keeps nearby instances and excludes remote instances in the same batch', () => {
    const { mesh, addAt } = batch()
    const near = addAt(5, 0)
    const far = addAt(30, 0)
    const scratch = createReflectionScopeScratch()

    withDayReflectionScope([mesh], pond, 6, scratch, () => {
      expect(mesh.getVisibleAt(near)).toBe(true)
      expect(mesh.getVisibleAt(far)).toBe(false)
    })

    expect(mesh.getVisibleAt(far)).toBe(true)
  })

  it('uses the batch and instance transforms to derive world bounds', () => {
    const { mesh, addAt } = batch()
    mesh.position.x = 40
    mesh.updateMatrixWorld(true)
    const nearInWorld = addAt(-35, 0)
    const farInWorld = addAt(0, 0)
    const scratch = createReflectionScopeScratch()

    withDayReflectionScope([mesh], pond, 6, scratch, () => {
      expect(mesh.getVisibleAt(nearInWorld)).toBe(true)
      expect(mesh.getVisibleAt(farInWorld)).toBe(false)
    })
  })

  it('preserves hidden instances and skips deleted ids', () => {
    const { mesh, addAt } = batch()
    const hidden = addAt(30, 0)
    const deleted = addAt(30, 0)
    mesh.setVisibleAt(hidden, false)
    mesh.deleteInstance(deleted)
    const scratch = createReflectionScopeScratch()
    const seen: number[] = []

    withDayReflectionScope([mesh], pond, 6, scratch, () => {
      forEachReflectionInstance(mesh, scratch, (id) => seen.push(id))
      expect(mesh.getVisibleAt(hidden)).toBe(false)
      expect(seen).not.toContain(deleted)
    })

    expect(mesh.getVisibleAt(hidden)).toBe(false)
  })

  it('restores visibility when the mirrored draw throws', () => {
    const { mesh, addAt } = batch()
    const far = addAt(30, 0)
    const scratch = createReflectionScopeScratch()

    expect(() =>
      withDayReflectionScope([mesh], pond, 6, scratch, () => {
        expect(mesh.getVisibleAt(far)).toBe(false)
        throw new Error('render failed')
      }),
    ).toThrow('render failed')
    expect(mesh.getVisibleAt(far)).toBe(true)
  })
})
