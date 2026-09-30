import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  classifyWaterBatch,
  discoverWaterBatches,
  NIGHT_REFLECTION_CUTOFF,
  pondTouchesFrustum,
  shouldSkipReflection,
  unionPondBounds,
  type WaterBatchRoles,
} from './waterReflectionSkip'

const roles = (waterMaterial: unknown = 'water-mat'): WaterBatchRoles => ({
  waterMaterial,
  emissiveMaterials: new Set(['neon-mat']),
  hiddenMaterials: new Set(['water-mat', 'glow-mat']),
})

const batch = (name: string, material: unknown) => ({ name, material })

describe('shouldSkipReflection', () => {
  const runnable = {
    enabled: true,
    night: 1,
    hasWater: true,
    pondInFrustum: true,
  }

  it('renders when the switch is on, night is up and the pond is visible', () => {
    expect(shouldSkipReflection(runnable)).toBe(false)
  })

  it('skips on `?reflection=off`', () => {
    expect(shouldSkipReflection({ ...runnable, enabled: false })).toBe(true)
  })

  it('skips when look.night is near zero', () => {
    expect(shouldSkipReflection({ ...runnable, night: 0 })).toBe(true)
    expect(shouldSkipReflection({ ...runnable, night: NIGHT_REFLECTION_CUTOFF })).toBe(true)
    expect(shouldSkipReflection({ ...runnable, night: NIGHT_REFLECTION_CUTOFF + 0.01 })).toBe(false)
  })

  it('skips when no water batch was discovered', () => {
    expect(shouldSkipReflection({ ...runnable, hasWater: false })).toBe(true)
  })

  it('skips when the pond is off-frustum', () => {
    expect(shouldSkipReflection({ ...runnable, pondInFrustum: false })).toBe(true)
  })

  it('fails closed on a NaN night', () => {
    expect(shouldSkipReflection({ ...runnable, night: Number.NaN })).toBe(true)
  })
})

describe('discoverWaterBatches', () => {
  const batches = [
    batch('cream', 'cream-mat'),
    batch('neon', 'neon-mat'),
    batch('neonGlow', 'glow-mat'),
    batch('water', 'water-mat'),
  ]

  it('partitions by material identity', () => {
    const found = discoverWaterBatches(batches, roles())
    expect(found.pool.map((b) => b.name)).toEqual(['water'])
    expect(found.emissive.map((b) => b.name)).toEqual(['neon'])
    expect(found.hidden.map((b) => b.name)).toEqual(['neonGlow'])
    expect(found.occluders.map((b) => b.name)).toEqual(['cream'])
  })

  it('finds a second water batch whatever it is named', () => {
    const found = discoverWaterBatches(
      [...batches, batch('river-nested-in-a-group', 'water-mat')],
      roles(),
    )
    expect(found.pool.map((b) => b.name)).toEqual(['water', 'river-nested-in-a-group'])
  })

  it('ignores names: a batch called water with another material occludes', () => {
    const found = discoverWaterBatches([batch('water', 'cream-mat')], roles())
    expect(found.pool).toEqual([])
    expect(found.occluders.map((b) => b.name)).toEqual(['water'])
  })

  it('discovers no pool when the water material is missing, so the pass skips', () => {
    const found = discoverWaterBatches(batches, roles(null))
    expect(found.pool).toEqual([])
    expect(
      shouldSkipReflection({
        enabled: true,
        night: 1,
        hasWater: found.pool.length > 0,
        pondInFrustum: true,
      }),
    ).toBe(true)
  })

  it('matches a multi-material batch carrying the water material', () => {
    const found = discoverWaterBatches([batch('blend', ['cream-mat', 'water-mat'])], roles())
    expect(found.pool.map((b) => b.name)).toEqual(['blend'])
  })

  it('sends unknown materials to the occluders', () => {
    const found = discoverWaterBatches([batch('future-batch', 'future-mat')], roles())
    expect(found.occluders.map((b) => b.name)).toEqual(['future-batch'])
  })
})

describe('unionPondBounds', () => {
  it('is null with no ponds, so the rig skips', () => {
    expect(unionPondBounds([])).toBeNull()
  })

  it('unions every pond batch', () => {
    const union = unionPondBounds([
      new Box3(new Vector3(0, 0, 0), new Vector3(2, 0, 2)),
      new Box3(new Vector3(10, 1, 10), new Vector3(12, 1, 12)),
    ])
    expect(union?.min.toArray()).toEqual([0, 0, 0])
    expect(union?.max.toArray()).toEqual([12, 1, 12])
  })
})

describe('pondTouchesFrustum', () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 2, 6)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )

  it('sees the pond ahead of the camera', () => {
    expect(
      pondTouchesFrustum(frustum, new Box3(new Vector3(-1, -0.1, -1), new Vector3(1, 0.1, 1))),
    ).toBe(true)
  })

  it('misses the pond behind the camera', () => {
    expect(
      pondTouchesFrustum(frustum, new Box3(new Vector3(-1, -0.1, 19), new Vector3(1, 0.1, 21))),
    ).toBe(false)
  })

  it('misses the pond far off-axis', () => {
    expect(
      pondTouchesFrustum(frustum, new Box3(new Vector3(49, -0.1, -1), new Vector3(51, 0.1, 1))),
    ).toBe(false)
  })
})

describe('classifyWaterBatch', () => {
  const r = roles()

  it('matches discoverWaterBatches on a mixed registry', () => {
    const batches = [
      batch('pond', 'water-mat'),
      batch('pond-2', 'water-mat'),
      batch('strip', 'neon-mat'),
      batch('glow', 'glow-mat'),
      batch('terrace', 'cream-mat'),
      batch('multi', ['cream-mat', 'neon-mat']),
      batch('multi-water', ['cream-mat', 'water-mat']),
    ]
    const found = discoverWaterBatches(batches, r)
    for (const b of found.pool) expect(classifyWaterBatch(b.material, r)).toBe('pool')
    for (const b of found.hidden) expect(classifyWaterBatch(b.material, r)).toBe('hidden')
    for (const b of found.emissive) expect(classifyWaterBatch(b.material, r)).toBe('emissive')
    for (const b of found.occluders) expect(classifyWaterBatch(b.material, r)).toBe('occluder')
  })

  it('allocates nothing: single materials classify without array wrapping', () => {
    expect(classifyWaterBatch('water-mat', r)).toBe('pool')
    expect(classifyWaterBatch('glow-mat', r)).toBe('hidden')
    expect(classifyWaterBatch('neon-mat', r)).toBe('emissive')
    expect(classifyWaterBatch('cream-mat', r)).toBe('occluder')
    expect(classifyWaterBatch('cream-mat', roles(null))).toBe('occluder')
  })
})
