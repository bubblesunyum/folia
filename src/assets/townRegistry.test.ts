import { BatchedMesh, BoxGeometry, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { BatchCapacity } from './townBatches'
import { type MeshFactory, type TownGeometries, TownRegistry } from './townRegistry'

function box(size: number): BoxGeometry {
  return new BoxGeometry(size, size, size)
}

const factory: MeshFactory = (batch, cap) => {
  const mesh = new BatchedMesh(
    cap.maxInstances,
    cap.maxVertices,
    cap.maxIndices,
    new MeshBasicMaterial(),
  )
  mesh.name = batch
  return mesh
}

const caps = (overrides: Partial<BatchCapacity> = {}): Map<string, BatchCapacity> =>
  new Map([
    ['cream', { maxInstances: 8, maxVertices: 4096, maxIndices: 8192, ...overrides }],
    ['neon', { maxInstances: 8, maxVertices: 4096, maxIndices: 8192 }],
  ])

const asset = (batches: Record<string, BoxGeometry[]>): TownGeometries =>
  new Map(Object.entries(batches))

describe('TownRegistry', () => {
  it('adds and removes an asset’s geometries as identity instances', () => {
    const registry = new TownRegistry(caps(), factory)
    registry.register('a', asset({ cream: [box(1), box(2)], neon: [box(1)] }))
    expect(registry.meshes.get('cream')?.instanceCount).toBe(2)
    expect(registry.meshes.get('neon')?.instanceCount).toBe(1)
    registry.unregister('a')
    expect(registry.meshes.get('cream')?.instanceCount).toBe(0)
    expect(registry.meshes.get('neon')?.instanceCount).toBe(0)
    // Re-registration reuses the freed ids.
    registry.register('a', asset({ cream: [box(1)] }))
    expect(registry.meshes.get('cream')?.instanceCount).toBe(1)
  })

  it('replaces an asset on re-registration', () => {
    const registry = new TownRegistry(caps(), factory)
    registry.register('a', asset({ cream: [box(1)] }))
    registry.register('a', asset({ cream: [box(1), box(2)] }))
    expect(registry.meshes.get('cream')?.instanceCount).toBe(2)
  })

  it('throws on an unknown batch and leaves no ghosts', () => {
    const registry = new TownRegistry(caps(), factory)
    expect(() => registry.register('a', asset({ cream: [box(1)], glass: [box(1)] }))).toThrow(
      /no shared material/,
    )
    expect(registry.meshes.get('cream')?.instanceCount).toBe(0)
    registry.register('b', asset({ cream: [box(1)] }))
    expect(registry.meshes.get('cream')?.instanceCount).toBe(1)
  })

  it('rolls back earlier batches when a geometry breaks the schema', () => {
    const registry = new TownRegistry(caps(), factory)
    // A lone geometry sets its batch's layout, and three only checks
    // batch-side attributes, so the violation needs a second geometry missing
    // one in the same batch.
    const bad = box(1)
    bad.deleteAttribute('uv')
    expect(() => registry.register('a', asset({ cream: [box(1)], neon: [box(1), bad] }))).toThrow(
      /consistent attributes/,
    )
    expect(registry.meshes.get('cream')?.instanceCount).toBe(0)
    expect(registry.meshes.get('neon')?.instanceCount).toBe(0)
  })

  it('grows until the list fits, migrates, and retires the old mesh', () => {
    const onGrow = vi.fn()
    const registry = new TownRegistry(
      new Map([['cream', { maxInstances: 1, maxVertices: 48, maxIndices: 72 }]]),
      factory,
      onGrow,
    )
    const before = registry.meshes.get('cream')
    // One box reserves 48 verts / 72 indices: the second needs a grow, the
    // third needs another.
    registry.register('a', asset({ cream: [box(1), box(1), box(1)] }))
    const after = registry.meshes.get('cream')
    expect(after).not.toBe(before)
    expect(after?.instanceCount).toBe(3)
    expect(onGrow).toHaveBeenCalledTimes(2)
    expect(registry.drainRetired()).toEqual([before, expect.any(BatchedMesh)])
    expect(registry.drainRetired()).toEqual([])
  })

  it('unregisters cleanly after growth', () => {
    const registry = new TownRegistry(
      new Map([['cream', { maxInstances: 1, maxVertices: 48, maxIndices: 72 }]]),
      factory,
    )
    registry.register('a', asset({ cream: [box(1), box(1)] }))
    registry.register('b', asset({ cream: [box(1)] }))
    expect(registry.meshes.get('cream')?.instanceCount).toBe(3)
    registry.unregister('a')
    expect(registry.meshes.get('cream')?.instanceCount).toBe(1)
    registry.unregister('b')
    expect(registry.meshes.get('cream')?.instanceCount).toBe(0)
  })

  it('compacts before growing, so deletes do not ratchet capacity upward', () => {
    const onGrow = vi.fn()
    // One box reserves 48 verts / 72 indices: this mesh holds exactly two.
    const registry = new TownRegistry(
      new Map([['cream', { maxInstances: 8, maxVertices: 96, maxIndices: 144 }]]),
      factory,
      onGrow,
    )
    const before = registry.meshes.get('cream')
    registry.register('a', asset({ cream: [box(1), box(1)] }))
    registry.unregister('a')
    // Freed ranges are reused: the same two boxes fit without doubling.
    registry.register('b', asset({ cream: [box(1), box(1)] }))
    expect(registry.meshes.get('cream')).toBe(before)
    expect(onGrow).not.toHaveBeenCalled()
    expect(registry.meshes.get('cream')?.instanceCount).toBe(2)
    // Repeated churn still never grows.
    registry.unregister('b')
    for (let i = 0; i < 5; i++) {
      registry.register(`churn-${i}`, asset({ cream: [box(1), box(1)] }))
      expect(registry.meshes.get('cream')).toBe(before)
      registry.unregister(`churn-${i}`)
    }
    expect(onGrow).not.toHaveBeenCalled()
  })

  it('still grows when live content truly exceeds capacity', () => {
    const onGrow = vi.fn()
    const registry = new TownRegistry(
      new Map([['cream', { maxInstances: 8, maxVertices: 96, maxIndices: 144 }]]),
      factory,
      onGrow,
    )
    registry.register('a', asset({ cream: [box(1), box(1)] }))
    registry.unregister('a')
    // Reuse the freed ranges first, then exceed them: the third live box
    // needs a real double, not a compaction.
    registry.register('b', asset({ cream: [box(1), box(1)] }))
    expect(onGrow).not.toHaveBeenCalled()
    registry.register('c', asset({ cream: [box(1)] }))
    expect(onGrow).toHaveBeenCalledTimes(1)
    expect(registry.meshes.get('cream')?.instanceCount).toBe(3)
  })

  it('keeps whole-mesh bounds tracking content, so culling never goes stale', () => {
    const registry = new TownRegistry(caps(), factory)
    const near = box(1)
    const far = box(1)
    far.translate(100, 0, 0)
    registry.register('plot', asset({ cream: [near, far] }))
    const mesh = registry.meshes.get('cream')
    expect(mesh?.boundingSphere?.containsPoint(new Vector3(100, 0, 0))).toBe(true)
    registry.unregister('plot')
    registry.register('home', asset({ cream: [box(1)] }))
    expect(mesh?.boundingSphere?.containsPoint(new Vector3(100, 0, 0))).toBe(false)
  })

  it('bumps the version on every content change', () => {
    const registry = new TownRegistry(caps(), factory)
    const v0 = registry.version
    registry.register('a', asset({ cream: [box(1)] }))
    expect(registry.version).toBeGreaterThan(v0)
    const v1 = registry.version
    registry.unregister('a')
    expect(registry.version).toBeGreaterThan(v1)
  })
})
