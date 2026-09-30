import { DirectionalLight, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SHADOW_FITS } from '../perf/renderConfig'
import {
  computeSnapDelta,
  quantizeExtent,
  SHADOW_MAP_SIZE,
  type ShadowSnapBase,
  snapShadowToTexels,
  texelSize,
} from './shadowFit'

describe('shadow fits', () => {
  it('rounds extents up to a power of two', () => {
    expect(quantizeExtent(16)).toBe(16)
    expect(quantizeExtent(9)).toBe(16)
    expect(quantizeExtent(8)).toBe(8)
  })

  it('sizes texels from the fit at 2048', () => {
    expect(texelSize(SHADOW_FITS.town, SHADOW_MAP_SIZE)).toBeCloseTo(0.0156, 4)
    expect(texelSize(SHADOW_FITS.vantage, SHADOW_MAP_SIZE)).toBeCloseTo(0.0078, 4)
  })
})

const SNAP_DISTANCE = 40
const SNAP_EXTENT = quantizeExtent(SHADOW_FITS.town)

function sunBase(direction: readonly [number, number, number]): ShadowSnapBase {
  return {
    position: new Vector3(
      direction[0] * SNAP_DISTANCE,
      direction[1] * SNAP_DISTANCE,
      direction[2] * SNAP_DISTANCE,
    ),
    target: new Vector3(0, 0, 0),
  }
}

function makeSun(): DirectionalLight {
  const light = new DirectionalLight()
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  return light
}

/** One rendered frame's worth: the rig resets nothing, the snap derives all. */
function frame(light: DirectionalLight, base: ShadowSnapBase): void {
  snapShadowToTexels(light, SNAP_EXTENT, base)
}

describe('computeSnapDelta', () => {
  it('lands each axis projection on a whole texel', () => {
    const out = new Vector3()
    computeSnapDelta(new Vector3(1.3, 2.7, 5), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 1, out)
    expect(out.x).toBeCloseTo(-0.3, 12)
    expect(out.y).toBeCloseTo(0.3, 12)
    expect(out.z).toBeCloseTo(0, 12)
  })
})

describe('snapShadowToTexels', () => {
  const morning: [number, number, number] = [0.83, 0.34, 0.44]
  const noon: [number, number, number] = [0.02, 1, 0.03]
  const evening: [number, number, number] = [-0.79, 0.28, 0.55]

  it('is idempotent frame-to-frame for a static sun (no walk)', () => {
    const light = makeSun()
    const base = sunBase(morning)
    frame(light, base)
    const position = light.position.clone()
    const target = light.target.position.clone()
    for (let i = 0; i < 10; i += 1) {
      frame(light, base)
      expect(light.position.equals(position)).toBe(true)
      expect(light.target.position.equals(target)).toBe(true)
    }
  })

  it('a sun move A→B→A returns to the starting position (no drift)', () => {
    const light = makeSun()
    const a = sunBase(morning)
    const b = sunBase(evening)
    frame(light, a)
    frame(light, a)
    const position = light.position.clone()
    const target = light.target.position.clone()
    frame(light, b)
    frame(light, b)
    expect(light.position.equals(position)).toBe(false)
    frame(light, a)
    frame(light, a)
    expect(light.position.equals(position)).toBe(true)
    expect(light.target.position.equals(target)).toBe(true)
  })

  it('moves light and target by the same delta (direction preserved)', () => {
    const light = makeSun()
    const base = sunBase(morning)
    const before = base.position.clone().sub(base.target)
    frame(light, base)
    const after = light.position.clone().sub(light.target.position)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(after.z).toBeCloseTo(before.z, 10)
  })

  it('a sun sweep across the day returns to the start with no walk', () => {
    const light = makeSun()
    const start = sunBase(morning)
    const sweep = [noon, evening, noon, morning].map(sunBase)
    frame(light, start)
    frame(light, start)
    const position = light.position.clone()
    const target = light.target.position.clone()
    for (const base of sweep) {
      // Two frames per sun step, like the rig settling after a look change.
      frame(light, base)
      frame(light, base)
    }
    expect(light.position.equals(position)).toBe(true)
    expect(light.target.position.equals(target)).toBe(true)
    // And it stays put once back.
    frame(light, start)
    expect(light.position.equals(position)).toBe(true)
    expect(light.target.position.equals(target)).toBe(true)
  })
})
