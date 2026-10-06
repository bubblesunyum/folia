import { BatchedMesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import art from '../../content/town/art.json' with { type: 'json' }
import blackjack from '../../content/town/blackjack-genius.json' with { type: 'json' }
import cortico from '../../content/town/cortico.json' with { type: 'json' }
import earlyWork from '../../content/town/early-work.json' with { type: 'json' }
import expressMess from '../../content/town/express-your-mess.json' with { type: 'json' }
import expressYes from '../../content/town/express-your-yes.json' with { type: 'json' }
import glyphite from '../../content/town/glyphite.json' with { type: 'json' }
import ironOx from '../../content/town/iron-ox.json' with { type: 'json' }
import purple from '../../content/town/purple-republic.json' with { type: 'json' }
import river from '../../content/town/river.json' with { type: 'json' }
import {
  capacityFromManifest,
  grownCapacity,
  hoodOffset,
  LOD_RESERVE,
  type ManifestCounts,
  manifestCounts,
  parseHoodPlacement,
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

describe('manifestCounts', () => {
  const triangles = {
    'cortico/fragment': { cream: 107920, neon: 1968 },
    'cortico/second': { cream: 1000 },
  }
  const vertices = {
    'cortico/fragment': { cream: 80000, neon: 1500 },
  }
  const indices = {
    'cortico/fragment': { cream: 323760, neon: 5904 },
  }

  it('joins the per-batch maps into exact counts where both are present', () => {
    expect(manifestCounts(triangles, vertices, indices)).toEqual({
      'cortico/fragment': {
        cream: { triangles: 107920, vertices: 80000, indices: 323760 },
        neon: { triangles: 1968, vertices: 1500, indices: 5904 },
      },
      'cortico/second': { cream: 1000 },
    })
  })

  it('leaves triangle totals alone when counts are missing entirely', () => {
    expect(manifestCounts(triangles)).toEqual(triangles)
  })

  it('falls back per batch when only one of vertices/indices is present', () => {
    const counts = manifestCounts(triangles, vertices, {
      'cortico/fragment': { cream: 323760 },
    })
    expect(counts['cortico/fragment']).toEqual({
      cream: { triangles: 107920, vertices: 80000, indices: 323760 },
      neon: 1968,
    })
  })

  it('sizes runtime capacity from the joined counts end to end', () => {
    const cap = capacityFromManifest(manifestCounts(triangles, vertices, indices))
    // cream has an uncounted asset, so the whole batch falls back to tris×3.
    expect(cap.cream?.maxVertices).toBe((107920 + 1000) * 3 * 4)
    // neon is fully counted: exact vertices times reserve and headroom.
    expect(cap.neon?.maxVertices).toBe(1500 * LOD_RESERVE * 4)
    expect(cap.neon?.maxIndices).toBe(5904 * LOD_RESERVE * 4)
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

const placements = [
  ['cortico', cortico],
  ['early-work', earlyWork],
  ['blackjack-genius', blackjack],
  ['glyphite', glyphite],
  ['purple-republic', purple],
  ['express-your-mess', expressMess],
  ['express-your-yes', expressYes],
  ['iron-ox', ironOx],
  ['art', art],
] as const

describe('town placement (fol-l7d.1)', () => {
  it('parses every per-hood file, with unique hoods', () => {
    const parsed = placements.map(([file, raw]) =>
      parseHoodPlacement(raw, `content/town/${file}.json`),
    )
    expect(parsed.map((p) => p.hood).sort()).toEqual([
      'art',
      'blackjack-genius',
      'cortico',
      'early-work',
      'express-your-mess',
      'express-your-yes',
      'glyphite',
      'iron-ox',
      'purple-republic',
    ])
  })

  it('keeps cortico at the origin, so the baked light pools ride untouched', () => {
    const place = parseHoodPlacement(cortico, 'content/town/cortico.json')
    expect(hoodOffset(place)).toEqual([0, 0, 0])
  })

  it('orders plots down the river, oldest north to newest south', () => {
    const ordered = placements
      .map(([file, raw]) => ({ file, ...parseHoodPlacement(raw, String(file)) }))
      .filter((p) => p.hood !== 'cortico' && p.hood !== 'art')
      .sort((a, b) => a.centre[1] - b.centre[1])
    expect(ordered.map((p) => p.hood)).toEqual([
      'early-work',
      'blackjack-genius',
      'glyphite',
      'purple-republic',
      'express-your-mess',
      'express-your-yes',
      'iron-ox',
    ])
  })

  it('holds every plot clear of the river channel', () => {
    const riverData = river as { width: number; course: number[][] }
    const half = riverData.width / 2
    for (const [file, raw] of placements) {
      const place = parseHoodPlacement(raw, String(file))
      if (place.hood === 'cortico') continue
      const course = riverData.course
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < course.length - 1; i++) {
        const a = course[i]
        const b = course[i + 1]
        if (!a || !b || a.length !== 2 || b.length !== 2) continue
        const [ax, az] = a as [number, number]
        const [bx, bz] = b as [number, number]
        const abx = bx - ax
        const abz = bz - az
        const denom = abx * abx + abz * abz || 1
        const t = Math.max(
          0,
          Math.min(1, ((place.centre[0] - ax) * abx + (place.centre[1] - az) * abz) / denom),
        )
        best = Math.min(
          best,
          Math.hypot(place.centre[0] - (ax + abx * t), place.centre[1] - (az + abz * t)),
        )
      }
      expect(best).toBeGreaterThan(half + place.radius)
    }
  })

  it('fails closed on drift', () => {
    expect(() => parseHoodPlacement(null, 'content/town/x.json')).toThrow()
    expect(() => parseHoodPlacement({ hood: 'Bad Hood' }, 'content/town/x.json')).toThrow()
    expect(() =>
      parseHoodPlacement(
        { hood: 'x', centre: [0, Number.NaN], yaw: 0, radius: 1 },
        'content/town/x.json',
      ),
    ).toThrow()
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
