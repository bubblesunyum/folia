import { BatchedMesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import {
  capacityFromManifest,
  grownCapacity,
  LOD_RESERVE,
  type ManifestCounts,
  withDerivedCapacity,
} from './townBatches'

const FRAGMENT = { 'cortico/fragment': { cream: 107920, neon: 1968, water: 360 } }

// Same fragment shape with the pack-time counts fol-3w2 writes: fewer verts
// than tris×3 because indexed geometry shares vertices.
const FRAGMENT_COUNTS: ManifestCounts = {
  'cortico/fragment': {
    cream: { triangles: 107920, vertices: 80000, indices: 323760 },
    neon: { triangles: 1968, vertices: 1500, indices: 5904 },
    water: { triangles: 360, vertices: 300, indices: 1080 },
  },
}

describe('capacityFromManifest', () => {
  it('sizes batches from manifest totals times headroom', () => {
    const cap = capacityFromManifest(FRAGMENT)
    expect(cap.cream).toEqual({
      maxInstances: 16,
      maxVertices: 107920 * 3 * 4,
      maxIndices: 107920 * 3 * 4,
    })
    expect(cap.water?.maxInstances).toBe(16)
  })

  it('sums triangles and counts assets across the town', () => {
    const cap = capacityFromManifest({
      ...FRAGMENT,
      'cortico/second': { cream: 1000, neon: 10 },
    })
    expect(cap.cream?.maxVertices).toBe((107920 + 1000) * 3 * 4)
    expect(cap.cream?.maxInstances).toBe(2 * 16)
    expect(cap.neon?.maxVertices).toBe((1968 + 10) * 3 * 4)
  })

  it('never sizes below the minimum', () => {
    const cap = capacityFromManifest({ tiny: {} })
    expect(cap.tiny).toBeUndefined()
    const empty = capacityFromManifest({ tiny: { cream: 0 } })
    expect(empty.cream).toEqual({ maxInstances: 16, maxVertices: 1024, maxIndices: 1024 })
  })

  it('sizes vertices and indices from pack-time counts times reserve and headroom', () => {
    const cap = capacityFromManifest(FRAGMENT_COUNTS)
    expect(cap.cream).toEqual({
      maxInstances: 16,
      maxVertices: 80000 * LOD_RESERVE * 4,
      maxIndices: 323760 * LOD_RESERVE * 4,
    })
    expect(cap.neon).toEqual({
      maxInstances: 16,
      maxVertices: 1500 * LOD_RESERVE * 4,
      maxIndices: 5904 * LOD_RESERVE * 4,
    })
  })

  it('falls back to triangles×3 for a batch any asset left uncounted', () => {
    const cap = capacityFromManifest({
      'cortico/fragment': {
        cream: { triangles: 107920, vertices: 80000, indices: 323760 },
      },
      'cortico/second': { cream: 1000 },
    })
    expect(cap.cream?.maxVertices).toBe((107920 + 1000) * 3 * 4)
    expect(cap.cream?.maxIndices).toBe((107920 + 1000) * 3 * 4)
    expect(cap.cream?.maxInstances).toBe(2 * 16)
  })

  it('cuts the shipped-GLB over-allocation from ~16x to reserve times headroom', () => {
    // The shipped town: 0.74 verts/tri (131k verts for 177k tris).
    const shipped = { town: { cream: { triangles: 177000, vertices: 131000, indices: 531000 } } }
    const cap = capacityFromManifest(shipped).cream
    const legacy = capacityFromManifest({ town: { cream: 177000 } }).cream
    expect(cap?.maxVertices).toBe(131000 * LOD_RESERVE * 4)
    expect(cap?.maxIndices).toBe(531000 * LOD_RESERVE * 4)
    expect(cap?.maxVertices).toBeLessThan(legacy?.maxVertices ?? Infinity)
    expect((cap?.maxVertices ?? 0) / 131000).toBeLessThanOrEqual(LOD_RESERVE * 4)
  })
})

describe('withDerivedCapacity', () => {
  it('gives derived batches their source batch’s room', () => {
    const cap = withDerivedCapacity(capacityFromManifest(FRAGMENT), { neonGlow: 'neon' })
    expect(cap.neonGlow).toEqual(cap.neon)
    expect(cap.cream && cap.neonGlow).not.toEqual(cap.cream)
  })

  it('leaves unknown sources out rather than inventing capacity', () => {
    const cap = withDerivedCapacity(capacityFromManifest(FRAGMENT), { glow: 'missing' })
    expect(cap.glow).toBeUndefined()
  })
})

describe('grownCapacity', () => {
  it('doubles every axis', () => {
    expect(grownCapacity({ maxInstances: 1, maxVertices: 2, maxIndices: 3 })).toEqual({
      maxInstances: 2,
      maxVertices: 4,
      maxIndices: 6,
    })
  })
})

function box(size: number): BoxGeometry {
  return new BoxGeometry(size, size, size)
}

function townMesh(instances: number, vertices: number, indices: number): BatchedMesh {
  return new BatchedMesh(instances, vertices, indices, new MeshBasicMaterial())
}

describe('town mesh mechanics', () => {
  it('adds and removes an asset’s geometries as identity instances', () => {
    const mesh = townMesh(8, 1024, 2048)
    const gids = [box(1), box(2)].map((geometry) => {
      const reserved = (geometry.attributes.position?.count ?? 0) * LOD_RESERVE
      const reservedIndex = (geometry.index?.count ?? 0) * LOD_RESERVE
      const gid = mesh.addGeometry(geometry, reserved, reservedIndex)
      mesh.addInstance(gid)
      return gid
    })
    expect(mesh.instanceCount).toBe(2)
    for (const gid of gids) mesh.deleteGeometry(gid)
    expect(mesh.instanceCount).toBe(0)
  })

  it('swaps a same-size LOD into reserved space, and throws past it', () => {
    const mesh = townMesh(4, 4096, 8192)
    const small = box(1)
    const gid = mesh.addGeometry(
      small,
      (small.attributes.position?.count ?? 0) * LOD_RESERVE,
      (small.index?.count ?? 0) * LOD_RESERVE,
    )
    mesh.addInstance(gid)
    // Same vertex layout: the day-to-day swap path.
    expect(() => mesh.setGeometryAt(gid, box(2))).not.toThrow()
    // A subdivided hi-LOD carries more verts than the 2x reservation.
    const hi = new BoxGeometry(1, 1, 1, 4, 4, 4)
    expect(hi.attributes.position?.count).toBeGreaterThan(
      (small.attributes.position?.count ?? 0) * LOD_RESERVE,
    )
    expect(() => mesh.setGeometryAt(gid, hi)).toThrow()
  })

  it('throws at capacity, and the grown mesh takes what overflowed', () => {
    const mesh = townMesh(1, 24, 36)
    const first = box(1)
    mesh.addInstance(mesh.addGeometry(first))
    expect(() => mesh.addGeometry(box(2))).toThrow()
    const grown = townMesh(2, 48, 72)
    grown.addInstance(grown.addGeometry(first))
    grown.addInstance(grown.addGeometry(box(2)))
    expect(grown.instanceCount).toBe(2)
  })
})
