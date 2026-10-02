import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyZoomDelta,
  clampZoomDistance,
  DETENT_GIVE_MAX,
  DETENT_THRESHOLD,
  easeOutCubic,
  initialZoomState,
  resolveZoomBase,
  shouldSnapZoom,
  ZOOM_SETTLE_EPS,
  ZOOM_STEP_DURATION_MS,
  zoomRenderDistance,
} from './zoomModel'

const limits = { minDistance: 20, maxDistance: 80 }

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches, media: '' }) })
}

describe('applyZoomDelta', () => {
  it('moves within the limits without tripping the detent', () => {
    const { state, risen } = applyZoomDelta(initialZoomState(50), 10, limits)
    expect(state.distance).toBe(60)
    expect(state.overscroll).toBe(0)
    expect(risen).toBe(false)
  })

  it('clamps zoom-in at the near limit', () => {
    const { state, risen } = applyZoomDelta(initialZoomState(25), -10, limits)
    expect(state.distance).toBe(20)
    expect(risen).toBe(false)
  })

  it('banks overscroll past the far limit instead of moving', () => {
    const { state, risen } = applyZoomDelta(initialZoomState(80), 3, limits)
    expect(state.distance).toBe(80)
    expect(state.overscroll).toBe(3)
    expect(risen).toBe(false)
  })

  it('trips the detent after a sustained push and resets', () => {
    let state = initialZoomState(80)
    let risen = false
    for (let i = 0; i < DETENT_THRESHOLD; i += 1) {
      ;({ state, risen } = applyZoomDelta(state, 2, limits))
      if (risen) break
    }
    expect(risen).toBe(true)
    expect(state).toEqual({ distance: 80, overscroll: 0 })
  })

  it('releases banked overscroll before moving on zoom-in', () => {
    const pushed = applyZoomDelta(initialZoomState(80), 4, limits).state
    const { state, risen } = applyZoomDelta(pushed, -2, limits)
    expect(state).toEqual({ distance: 80, overscroll: 2 })
    expect(risen).toBe(false)
  })

  it('ignores a zero or non-finite delta', () => {
    const start = initialZoomState(50)
    expect(applyZoomDelta(start, 0, limits).state).toBe(start)
    expect(applyZoomDelta(start, Number.NaN, limits).state).toBe(start)
  })
})

describe('zoomRenderDistance', () => {
  it('renders the clamped distance with no banked overscroll', () => {
    expect(zoomRenderDistance(initialZoomState(50))).toBe(50)
  })

  it('gives visibly past the far limit while banking', () => {
    const pushed = applyZoomDelta(initialZoomState(80), 4, limits).state
    const render = zoomRenderDistance(pushed)
    expect(render).toBeGreaterThan(80)
    expect(render).toBeLessThanOrEqual(80 + DETENT_GIVE_MAX)
  })

  it('caps the give so a full push never runs away', () => {
    const pushed = applyZoomDelta(initialZoomState(80), DETENT_THRESHOLD - 0.5, limits).state
    expect(pushed.overscroll).toBeGreaterThan(0)
    expect(zoomRenderDistance(pushed)).toBeLessThanOrEqual(80 + DETENT_GIVE_MAX)
  })

  it('releases back to the far limit on the rise', () => {
    let state = initialZoomState(80)
    let risen = false
    for (let i = 0; i < DETENT_THRESHOLD; i += 1) {
      ;({ state, risen } = applyZoomDelta(state, 2, limits))
      if (risen) break
    }
    expect(risen).toBe(true)
    expect(zoomRenderDistance(state)).toBe(80)
  })
})

describe('zoom easing', () => {
  it('eases out from 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('clamps outside the unit interval', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })

  it('settles discrete steps quickly enough to feel instant', () => {
    expect(ZOOM_STEP_DURATION_MS).toBeLessThanOrEqual(250)
  })
})

describe('resolveZoomBase', () => {
  it('keeps the bank and clamps the camera while idle', () => {
    const base = resolveZoomBase(
      { cameraDistance: 50, lastRender: 50, overscroll: 3, tweenTo: null },
      limits,
    )
    expect(base).toEqual({ distance: 50, overscroll: 3, interrupted: false, external: false })
  })

  it('resumes from the interrupted tween target so rapid steps accumulate', () => {
    // Two +4 steps from 50 with no frame between: the second must build on
    // the first tween's target (54), not the unmoved camera (50).
    const first = resolveZoomBase(
      { cameraDistance: 50, lastRender: 50, overscroll: 0, tweenTo: null },
      limits,
    )
    const afterFirst = applyZoomDelta(first, 4, limits).state
    const second = resolveZoomBase(
      {
        cameraDistance: 50,
        lastRender: zoomRenderDistance(afterFirst),
        overscroll: afterFirst.overscroll,
        tweenTo: zoomRenderDistance(afterFirst),
      },
      limits,
    )
    expect(second.interrupted).toBe(true)
    const afterSecond = applyZoomDelta(second, 4, limits).state
    expect(afterSecond.distance).toBe(58)
  })

  it('strips visible give from the interrupted target and rebuilds it from the bank', () => {
    const base = resolveZoomBase(
      { cameraDistance: 80.5, lastRender: 81, overscroll: 4, tweenTo: 81 },
      limits,
    )
    expect(base.distance).toBe(80)
    expect(base.overscroll).toBe(4)
    expect(base.interrupted).toBe(true)
  })

  it('resets the bank when an idle camera moved externally', () => {
    const base = resolveZoomBase(
      { cameraDistance: 60, lastRender: 50, overscroll: 4, tweenTo: null },
      limits,
    )
    expect(base).toEqual({ distance: 60, overscroll: 0, interrupted: false, external: true })
  })

  it('clamps the base into the limits', () => {
    expect(clampZoomDistance(10, limits)).toBe(20)
    expect(clampZoomDistance(100, limits)).toBe(80)
  })
})

describe('shouldSnapZoom', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('snaps far steps when the intent reader reports reduced motion', () => {
    stubReducedMotion(true)
    expect(shouldSnapZoom(50, 80)).toBe(true)
  })

  it('eases far steps when motion is full', () => {
    stubReducedMotion(false)
    expect(shouldSnapZoom(50, 80)).toBe(false)
  })

  it('snaps settled steps even with full motion', () => {
    stubReducedMotion(false)
    expect(shouldSnapZoom(80, 80)).toBe(true)
    expect(shouldSnapZoom(80 + ZOOM_SETTLE_EPS / 2, 80)).toBe(true)
  })

  it('reads false outside the browser through the guarded reader', () => {
    expect(shouldSnapZoom(50, 80)).toBe(false)
  })

  it('follows the intent reader, not its own media query', () => {
    // A matchMedia that answers true to anything except the reduce query
    // must still read as full motion: the decision echoes the reader.
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query !== '(prefers-reduced-motion: reduce)',
        media: query,
      }),
    })
    expect(shouldSnapZoom(50, 80)).toBe(false)
  })
})

describe('one reduced-motion reader', () => {
  it('zoomModel holds no local matchMedia query', () => {
    const source = readFileSync(new URL('./zoomModel.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('window.matchMedia')
    expect(source).not.toContain('.matchMedia(')
    expect(source).not.toContain('prefers-reduced-motion')
    expect(source).toContain('readReducedMotion')
  })
})
