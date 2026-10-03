// Per-group hit volumes (fol-hft): pure math, no renderer. A floor quad on
// slot 7 with a pedestal top on slot 9 above it proves the D-021 contract:
// a ray through both resolves the nearer pedestal, a ray past it the floor.

import { describe, expect, it } from 'vitest'
import {
  buildHitVolumes,
  type HitVolumeSource,
  isPickableBatch,
  pickHitVolume,
  rayBoxEntry,
  type Vec3,
} from './hitVolumes'

/** One quad in the XZ plane at height `y`, two triangles, one slot. */
function quad(
  batch: string,
  slot: number | undefined,
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): HitVolumeSource {
  const positions = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]
  const order = [0, 1, 2, 0, 2, 3]
  return {
    batch,
    vertexCount: 4,
    indexCount: 6,
    positionAt: (v): Vec3 => [
      positions[v * 3] ?? 0,
      positions[v * 3 + 1] ?? 0,
      positions[v * 3 + 2] ?? 0,
    ],
    groupAt: () => slot,
    indexAt: (i) => order[i] ?? 0,
  }
}

const down: Vec3 = [0, -1, 0]

describe('isPickableBatch', () => {
  it('excludes the additive neon glow shell', () => {
    expect(isPickableBatch('neonGlow')).toBe(false)
    expect(isPickableBatch('neon')).toBe(true)
    expect(isPickableBatch('cream')).toBe(true)
  })
})

describe('buildHitVolumes', () => {
  it('buckets triangles by slot with tight boxes', () => {
    const volumes = buildHitVolumes([
      quad('cream', 7, 0, -10, 10, -10, 10),
      quad('cream', 9, 2, -1, 1, -1, 1),
    ])
    expect([...volumes.keys()].sort()).toEqual([7, 9])
    expect(volumes.get(9)).toMatchObject({ min: [-1, 2, -1], max: [1, 2, 1], triangles: 2 })
    expect(volumes.get(7)).toMatchObject({ min: [-10, 0, -10], max: [10, 0, 10], triangles: 2 })
  })

  it('drops the glow shell, zero-fill and slotless triangles', () => {
    const zero: HitVolumeSource = {
      batch: 'cream',
      vertexCount: 3,
      indexCount: 3,
      positionAt: () => [0, 0, 0],
      groupAt: () => 4,
      indexAt: (i) => i,
    }
    const volumes = buildHitVolumes([
      quad('neonGlow', 3, 5, -10, 10, -10, 10),
      quad('cream', undefined, 1, -10, 10, -10, 10),
      zero,
    ])
    expect(volumes.size).toBe(0)
  })

  it('reads non-indexed geometry sequentially', () => {
    const tri: HitVolumeSource = {
      batch: 'gold',
      vertexCount: 3,
      indexCount: 3,
      positionAt: (v): Vec3 => {
        const corners: Vec3[] = [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ]
        return corners[v] ?? [0, 0, 0]
      },
      groupAt: () => 5,
      indexAt: null,
    }
    const volumes = buildHitVolumes([tri])
    expect(volumes.get(5)?.triangles).toBe(1)
  })

  it('buckets an offset index slice: the pick path clips to live geometry ranges', () => {
    // One merged buffer, two tris; the source exposes only the second tri via
    // an offset slice — the shape pickSlot builds per live instance, so a
    // deleted-but-uncompacted range never reaches the soup.
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0]
    const order = [0, 1, 2, 3, 4, 5]
    const slice: HitVolumeSource = {
      batch: 'cream',
      vertexCount: 6,
      indexCount: 3,
      positionAt: (v): Vec3 => [
        positions[v * 3] ?? 0,
        positions[v * 3 + 1] ?? 0,
        positions[v * 3 + 2] ?? 0,
      ],
      groupAt: (v) => (v < 3 ? 5 : 6),
      indexAt: (i) => order[3 + i] ?? 0,
    }
    const volumes = buildHitVolumes([slice])
    expect([...volumes.keys()]).toEqual([6])
    expect(volumes.get(6)?.triangles).toBe(1)
    expect(pickHitVolume(volumes, [10.25, 0.25, 5], [0, 0, -1])).toBe(6)
    expect(pickHitVolume(volumes, [0.25, 0.25, 5], [0, 0, -1])).toBeNull()
  })

  it('supports non-indexed offset ranges via an explicit index map', () => {
    const corners: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [10, 0, 0],
      [11, 0, 0],
      [10, 1, 0],
    ]
    const start = 3
    const range: HitVolumeSource = {
      batch: 'gold',
      vertexCount: 6,
      indexCount: 3,
      positionAt: (v): Vec3 => corners[v] ?? [0, 0, 0],
      groupAt: (v) => (v < 3 ? 5 : 6),
      indexAt: (i) => start + i,
    }
    const volumes = buildHitVolumes([range])
    expect([...volumes.keys()]).toEqual([6])
    expect(volumes.get(6)?.triangles).toBe(1)
  })
})

describe('rayBoxEntry', () => {
  it('enters, starts inside, misses and stays behind', () => {
    expect(rayBoxEntry([0, 10, 0], down, [-1, 0, -1], [1, 2, 1])).toBeCloseTo(8)
    expect(rayBoxEntry([0, 1, 0], down, [-1, 0, -1], [1, 2, 1])).toBe(0)
    expect(rayBoxEntry([5, 10, 5], down, [-1, 0, -1], [1, 2, 1])).toBeNull()
    expect(rayBoxEntry([0, -5, 0], down, [-1, 0, -1], [1, 2, 1])).toBeNull()
    // Parallel to a slab the ray rides outside of: a miss, not a divide by zero.
    expect(rayBoxEntry([5, 1, 0], [0, 0, 1], [-1, 0, -1], [1, 2, 1])).toBeNull()
  })
})

describe('pickHitVolume', () => {
  const volumes = buildHitVolumes([
    quad('cream', 7, 0, -10, 10, -10, 10),
    quad('gold', 9, 2, -1, 1, -1, 1),
  ])

  it('resolves the nearer pedestal through the floor box', () => {
    expect(pickHitVolume(volumes, [0, 10, 0], down)).toBe(9)
  })

  it('resolves the floor past the pedestal', () => {
    expect(pickHitVolume(volumes, [5, 10, 5], down)).toBe(7)
  })

  it('misses empty sky', () => {
    expect(pickHitVolume(volumes, [0, 10, 0], [0, 1, 0])).toBeNull()
    expect(pickHitVolume(new Map(), [0, 10, 0], down)).toBeNull()
  })

  it('hits backfaces: open shells pick from either side', () => {
    expect(pickHitVolume(volumes, [0, -5, 0], [0, 1, 0])).toBe(7)
  })
})
