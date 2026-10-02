import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPickCache, pickSlotFromHit } from './pickSlot'
import { pickStats, resetPickStats } from './pickStats'

function batchMesh(
  name: string,
  opts: {
    positions: number[]
    groups: number[]
    index?: number[]
    instances?: number
    noGroup?: boolean
  },
) {
  const { positions, groups, index } = opts
  const vertexCount = positions.length / 3
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
    instanceCount: opts.instances ?? 1,
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

  it('records the pick query milliseconds for the HUD', () => {
    const { pointer, raycaster } = rig([0.25, 0.25, 5], [0, 0, -1])
    const meshes = new Map([['cream', triMesh('cream', 9)]])
    pick(meshes, raycaster, pointer)
    expect(pickStats.picks).toBe(1)
    expect(pickStats.lastMs).toBeGreaterThanOrEqual(0)
    expect(pickStats.volumes).toBe(1)
    expect(pickStats.triangles).toBe(1)
  })
})
