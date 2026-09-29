import { describe, expect, it } from 'vitest'
import { applyZoomDelta, DETENT_THRESHOLD, initialZoomState } from './zoomModel'

const limits = { minDistance: 20, maxDistance: 80 }

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
