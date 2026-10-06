import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPickCache, pickSlotFromHit } from './pickSlot'
import { pickStats, resetPickStats } from './pickStats'

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Column-major translation matrix. */
function translation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

interface MatrixSink {
  fromArray(data: ArrayLike<number>, offset?: number): unknown
}

/**
 * Structural `BatchedMesh` stand-in: validate-on-read liveness like the real
 * thing (deleted ids throw), one identity instance of a single full-range
 * geometry by default. `hidden`, `dead` and `matrices` are read live per
 * call, so tests mutate them between picks on the same mesh object — the
 * unregister-without-optimize shape.
 */
function batchMesh(
  name: string,
  opts: {
    positions: number[]
    groups: number[]
    index?: number[]
    instances?: number
    noGroup?: boolean
    matrices?: number[][]
    hidden?: number[]
    dead?: number[]
    geometries?: Array<{ start: number; count: number }>
    instanceGeometry?: number[]
    maxInstances?: number
    matrixWorld?: number[]
  },
) {
  const { positions, groups, index } = opts
  const vertexCount = positions.length / 3
  const slots = opts.instances ?? 1
  // Live references: tests push into these between picks.
  const matrices = opts.matrices ?? []
  const hidden = opts.hidden ?? []
  const dead = opts.dead ?? []
  const geometries = opts.geometries ?? [{ start: 0, count: index ? index.length : vertexCount }]
  const assertLive = (id: number): void => {
    if (!Number.isInteger(id) || id < 0 || id >= slots || dead.includes(id)) {
      throw new Error(
        `THREE.BatchedMesh: Invalid instanceId ${id}. Instance is either out of range or has been deleted.`,
      )
    }
  }
  const position = {
    count: vertexCount,
    version: 7,
    getX: (v: number): number => positions[v * 3] ?? 0,
    getY: (v: number): number => positions[v * 3 + 1] ?? 0,
    getZ: (v: number): number => positions[v * 3 + 2] ?? 0,
  }
  const group = opts.noGroup
    ? undefined
    : { count: vertexCount, version: 3, getX: (v: number): number => groups[v] ?? 0 }
  const indexAttr = index
    ? { count: index.length, version: 5, getX: (i: number): number => index[i] ?? 0 }
    : null
  return {
    name,
    get instanceCount(): number {
      return (
        slots - new Set(dead.filter((id) => Number.isInteger(id) && id >= 0 && id < slots)).size
      )
    },
    maxInstanceCount: opts.maxInstances ?? Math.max(slots + 4, 8),
    ...(opts.matrixWorld ? { matrixWorld: { elements: opts.matrixWorld } } : {}),
    getVisibleAt: (id: number): boolean => {
      assertLive(id)
      return !hidden.includes(id)
    },
    getGeometryIdAt: (id: number): number => {
      assertLive(id)
      return opts.instanceGeometry?.[id] ?? 0
    },
    getMatrixAt: (id: number, target: MatrixSink): unknown => {
      assertLive(id)
      return target.fromArray(matrices[id] ?? IDENTITY16, 0)
    },
    getGeometryRangeAt: (
      gid: number,
      target: Record<string, number> = {},
    ): Record<string, number> => {
      const range = geometries[gid]
      if (!range) {
        throw new Error(
          `THREE.BatchedMesh: Invalid geometryId ${gid}. Geometry is either out of range or has been deleted.`,
        )
      }
      target.start = range.start
      target.count = range.count
      return target
    },
    geometry: {
      getAttribute: (attr: string): unknown =>
        attr === 'position' ? position : attr === 'groupId' ? group : undefined,
      getIndex: (): unknown => indexAttr,
    },
  }
}

/** One triangle in z=0 facing the ray, on `slot`. */
function triMesh(name: string, slot: number, z = 0, instances = 1) {
  return batchMesh(name, {
    positions: [0, 0, z, 1, 0, z, 0, 1, z],
    groups: [slot, slot, slot],
    index: [0, 1, 2],
    instances,
  })
}

function rig(origin: [number, number, number], direction: [number, number, number]) {
  const pointer = {}
  const raycaster = {
    setFromCamera: vi.fn(),
    ray: {
      origin: { x: origin[0], y: origin[1], z: origin[2] },
      direction: { x: direction[0], y: direction[1], z: direction[2] },
    },
  }
  return { pointer, raycaster }
}

function pick(meshes: unknown, raycaster: unknown, pointer: unknown) {
  return pickSlotFromHit(meshes as never, raycaster as never, pointer as never, {} as never)
}

beforeEach(() => {
  clearPickCache()
  resetPickStats()
})

describe('pickSlotFromHit', () => {
  it('returns null on a miss', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, 1])
    const meshes = new Map([['cream', triMesh('cream', 9)]])
    expect(pick(meshes, raycaster, pointer)).toBeNull()
    expect(raycaster.setFromCamera).toHaveBeenCalled()
  })

  it('reads the slot off the hit volume', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([['cream', triMesh('cream', 9)]])
    expect(pick(meshes, raycaster, pointer)).toBe(9)
  })

  it('throws on a missing groupId attribute', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const bad = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [],
      noGroup: true,
    })
    expect(() => pick(new Map([['cream', bad]]), raycaster, pointer)).toThrow(/groupId/)
  })

  it('excludes the glow shell even when it is nearer', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([
      ['cream', triMesh('cream', 9, 0)],
      ['neonGlow', triMesh('neonGlow', 3, 4)],
    ])
    expect(pick(meshes, raycaster, pointer)).toBe(9)
  })

  it('rebuilds volumes when the content fingerprint moves', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([['cream', triMesh('cream', 9, 0, 1)]])
    expect(pick(meshes, raycaster, pointer)).toBe(9)
    // Same mesh, same slot, one more instance: the fingerprint moves and the
    // changed content (slot 4) shows through on the rebuild.
    meshes.set('cream', triMesh('cream', 4, 0, 2))
    expect(pick(meshes, raycaster, pointer)).toBe(4)
  })

  it('rebuilds when a same-named mesh is replaced with matching attribute metadata', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([['cream', triMesh('cream', 9, 0)]])
    expect(pick(meshes, raycaster, pointer)).toBe(9)
    // New BufferAttributes can have the same sizes and versions while their
    // positions or group IDs differ; their mesh object identity must move the key.
    meshes.set(
      'cream',
      batchMesh('cream', {
        positions: [10, 0, 0, 11, 0, 0, 10, 1, 0],
        groups: [4, 4, 4],
        index: [0, 1, 2],
      }),
    )
    const overOld = rig([0.25, 0.25, 5], [0, 0, -1])
    const overNew = rig([10.25, 0.25, 5], [0, 0, -1])
    expect(pick(meshes, overOld.raycaster, pointer)).toBeNull()
    expect(pick(meshes, overNew.raycaster, pointer)).toBe(4)
  })

  it('records the pick query milliseconds for the HUD', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([['cream', triMesh('cream', 9)]])
    pick(meshes, raycaster, pointer)
    expect(pickStats.picks).toBe(1)
    expect(pickStats.lastMs).toBeGreaterThanOrEqual(0)
    expect(pickStats.volumes).toBe(1)
    expect(pickStats.triangles).toBe(1)
  })

  it('misses unmounted assets whose ranges were never compacted', () => {
    // Two tris in one buffer, two geometries, one instance each: unregistering
    // the second asset deletes without optimize(), so its bytes stay in the
    // buffer and only liveness keeps them unpickable (fol-kes.5).
    const dead: number[] = []
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0],
      groups: [5, 5, 5, 6, 6, 6],
      index: [0, 1, 2, 3, 4, 5],
      instances: 2,
      geometries: [
        { start: 0, count: 3 },
        { start: 3, count: 3 },
      ],
      instanceGeometry: [0, 1],
      dead,
    })
    const meshes = new Map([['cream', mesh]])
    const overA = rig([0.25, 0.25, 5], [0, 0, -1])
    const overB = rig([10.25, 0.25, 5], [0, 0, -1])
    expect(pick(meshes, overB.raycaster, overB.pointer)).toBe(6)
    expect(pick(meshes, overA.raycaster, overA.pointer)).toBe(5)
    expect(pickStats.triangles).toBe(2)
    // Unregister without compacting: same mesh object, stale bytes intact.
    dead.push(1)
    expect(pick(meshes, overB.raycaster, overB.pointer)).toBeNull()
    expect(pick(meshes, overA.raycaster, overA.pointer)).toBe(5)
    expect(pickStats.triangles).toBe(1)
    expect(pickStats.volumes).toBe(1)
  })

  it('picks instances at their transformed location, not their buffer location', () => {
    const matrices: number[][] = [translation(10, 0, 0)]
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [9, 9, 9],
      index: [0, 1, 2],
      matrices,
    })
    const meshes = new Map([['cream', mesh]])
    const overBuffer = rig([0.25, 0.25, 5], [0, 0, -1])
    const overMoved = rig([10.25, 0.25, 5], [0, 0, -1])
    expect(pick(meshes, overBuffer.raycaster, overBuffer.pointer)).toBeNull()
    expect(pick(meshes, overMoved.raycaster, overMoved.pointer)).toBe(9)
    // A matrix edit between hovers invalidates the cache: back at the buffer.
    matrices[0] = [...IDENTITY16]
    expect(pick(meshes, overMoved.raycaster, overMoved.pointer)).toBeNull()
    expect(pick(meshes, overBuffer.raycaster, overBuffer.pointer)).toBe(9)
  })

  it('premultiplies the batch matrixWorld like the raycast does', () => {
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [9, 9, 9],
      index: [0, 1, 2],
      matrixWorld: translation(0, 5, 0),
    })
    const meshes = new Map([['cream', mesh]])
    const overBuffer = rig([0.25, 0.25, 5], [0, 0, -1])
    const overMoved = rig([0.25, 5.25, 5], [0, 0, -1])
    expect(pick(meshes, overBuffer.raycaster, overBuffer.pointer)).toBeNull()
    expect(pick(meshes, overMoved.raycaster, overMoved.pointer)).toBe(9)
  })

  it('skips instances hidden via setVisibleAt', () => {
    const hidden: number[] = []
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [9, 9, 9],
      index: [0, 1, 2],
      instances: 2,
      matrices: [IDENTITY16, translation(10, 0, 0)],
      hidden,
    })
    const meshes = new Map([['cream', mesh]])
    const overFirst = rig([0.25, 0.25, 5], [0, 0, -1])
    const overSecond = rig([10.25, 0.25, 5], [0, 0, -1])
    expect(pick(meshes, overSecond.raycaster, overSecond.pointer)).toBe(9)
    hidden.push(1)
    expect(pick(meshes, overSecond.raycaster, overSecond.pointer)).toBeNull()
    expect(pick(meshes, overFirst.raycaster, overFirst.pointer)).toBe(9)
  })

  it('keys the cache on the registry version, skipping steady rescans', () => {
    const hidden: number[] = []
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [9, 9, 9],
      index: [0, 1, 2],
      hidden,
    })
    const meshes = new Map([['cream', mesh]])
    const over = rig([0.25, 0.25, 5], [0, 0, -1])
    const pickVersioned = (version: number) =>
      pickSlotFromHit(
        meshes as never,
        over.raycaster as never,
        over.pointer as never,
        {} as never,
        version,
      )
    expect(pickVersioned(1)).toBe(9)
    // Hidden without a version bump: the cached volumes still hit, proving
    // the steady pick skipped the per-instance rescan.
    hidden.push(0)
    expect(pickVersioned(1)).toBe(9)
    // The versioned visibility write rebuilds: the miss shows through.
    expect(pickVersioned(2)).toBeNull()
  })

  it('rebuilds on a version move after a matrix edit', () => {
    const matrices: number[][] = [[...IDENTITY16]]
    const mesh = batchMesh('cream', {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      groups: [9, 9, 9],
      index: [0, 1, 2],
      matrices,
    })
    const meshes = new Map([['cream', mesh]])
    const overBuffer = rig([0.25, 0.25, 5], [0, 0, -1])
    const overMoved = rig([10.25, 0.25, 5], [0, 0, -1])
    const at = (r: ReturnType<typeof rig>, version: number) =>
      pickSlotFromHit(
        meshes as never,
        r.raycaster as never,
        r.pointer as never,
        {} as never,
        version,
      )
    matrices[0] = translation(10, 0, 0)
    expect(at(overMoved, 1)).toBe(9)
    // Moved back without a version bump: the stale volumes still hit moved.
    matrices[0] = [...IDENTITY16]
    expect(at(overMoved, 1)).toBe(9)
    expect(at(overMoved, 2)).toBeNull()
    expect(at(overBuffer, 2)).toBe(9)
  })
})
