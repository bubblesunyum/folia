import { DirectionalLight, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SHADOW_FITS } from '../perf/renderConfig'
import {
  computeSnapDelta,
  quantizeExtent,
  resolveShadowRefresh,
  SHADOW_MAP_SIZE,
  type ShadowInvalidationState,
  type ShadowSnapBase,
  shadowNeedsRefresh,
  snapShadowToTexels,
  texelSize,
} from './shadowFit'

describe('shadow fits', () => {
  it('pins the per-preset extents: town unchanged, vantage covers the disc', () => {
    expect(SHADOW_FITS.town).toBe(16)
    expect(SHADOW_FITS.vantage).toBe(16)
  })

  it('covers each preset view: no quantized frustum clips its subject', () => {
    // The vantage ground disc is 18 m across (9 m radius); ±8 m clipped it.
    expect(quantizeExtent(SHADOW_FITS.vantage)).toBeGreaterThanOrEqual(9)
    expect(quantizeExtent(SHADOW_FITS.vantage)).toBe(16)
    expect(quantizeExtent(SHADOW_FITS.town)).toBe(16)
  })

  it('rounds extents up to a power of two', () => {
    expect(quantizeExtent(16)).toBe(16)
    expect(quantizeExtent(9)).toBe(16)
    expect(quantizeExtent(8)).toBe(8)
  })

  it('sizes texels from the fit at 2048', () => {
    expect(texelSize(SHADOW_FITS.town, SHADOW_MAP_SIZE)).toBeCloseTo(0.0156, 4)
    expect(texelSize(SHADOW_FITS.vantage, SHADOW_MAP_SIZE)).toBeCloseTo(0.0156, 4)
  })
})

describe('resolveShadowRefresh', () => {
  it('refreshes once per sun/look move while the sun is up, then holds', () => {
    // Live-day no longer auto-updates every frame (fol-kes.17): each
    // look/sun invalidation issues one refresh, and ambient-only frames skip
    // through the per-frame dirty check instead.
    expect(resolveShadowRefresh('live', 1, true)).toEqual({ autoUpdate: false, needsRefresh: true })
    expect(resolveShadowRefresh('live', 0.01, true)).toEqual({
      autoUpdate: false,
      needsRefresh: true,
    })
  })

  it('freezes after one final refresh at sunset, then holds all night', () => {
    // Sunset transition: freeze, but refresh once to settle the map.
    expect(resolveShadowRefresh('live', 0, true)).toEqual({
      autoUpdate: false,
      needsRefresh: true,
    })
    // Deep night: frozen, no per-frame refresh (the 475k-tri night pass).
    expect(resolveShadowRefresh('live', 0, false)).toEqual({
      autoUpdate: false,
      needsRefresh: false,
    })
  })

  it('restores live shadows at sunrise', () => {
    expect(resolveShadowRefresh('live', 0.5, false)).toEqual({
      autoUpdate: false,
      needsRefresh: true,
    })
  })

  it('keeps the static re-freeze regardless of sun', () => {
    expect(resolveShadowRefresh('static', 1, true)).toEqual({
      autoUpdate: false,
      needsRefresh: true,
    })
    expect(resolveShadowRefresh('static', 0, false)).toEqual({
      autoUpdate: false,
      needsRefresh: true,
    })
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

describe('shadowNeedsRefresh', () => {
  const look = { night: 0 }
  const state = (): ShadowInvalidationState => ({
    camera: [49.23, 41.38, 49.23],
    sun: [0.83, 0.34, 0.44],
    daylight: 1,
    look,
    liftUploads: 0,
    content: 0,
  })

  it('refreshes the first frame', () => {
    expect(shadowNeedsRefresh(null, state())).toBe(true)
  })

  it('skips ambient-only frames: sway time matches on every field', () => {
    expect(shadowNeedsRefresh(state(), state())).toBe(false)
  })

  it('refreshes on a camera move', () => {
    const next = state()
    next.camera = [50.23, 41.38, 49.23]
    expect(shadowNeedsRefresh(state(), next)).toBe(true)
  })

  it('refreshes on a sun move', () => {
    const next = state()
    next.sun = [0.02, 1, 0.03]
    expect(shadowNeedsRefresh(state(), next)).toBe(true)
  })

  it('refreshes on daylight, look and lift moves', () => {
    const daylight = state()
    daylight.daylight = 0
    expect(shadowNeedsRefresh(state(), daylight)).toBe(true)
    const lookNext = state()
    lookNext.look = { night: 0 }
    expect(shadowNeedsRefresh(state(), lookNext)).toBe(true)
    const lift = state()
    lift.liftUploads = 1
    expect(shadowNeedsRefresh(state(), lift)).toBe(true)
  })

  it('refreshes when town content arrives after the last shadow pass', () => {
    const arrived = state()
    arrived.content = 1
    expect(shadowNeedsRefresh(state(), arrived)).toBe(true)
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
