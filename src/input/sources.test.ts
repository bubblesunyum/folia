import { describe, expect, it } from 'vitest'
import { gestureToZoomDelta, keyToZoomDelta, pinchToZoomDelta, wheelToZoomDelta } from './sources'

describe('wheelToZoomDelta', () => {
  it('ignores a plain wheel: that is a pan, not a zoom', () => {
    expect(wheelToZoomDelta({ deltaY: 40, ctrlKey: false, deltaMode: 0 })).toBeNull()
  })

  it('maps ctrl+wheel deltaY to a signed zoom delta', () => {
    expect(wheelToZoomDelta({ deltaY: 20, ctrlKey: true, deltaMode: 0 })).toBeGreaterThan(0)
    expect(wheelToZoomDelta({ deltaY: -20, ctrlKey: true, deltaMode: 0 })).toBeLessThan(0)
  })

  it('scales line and page deltas up from pixels', () => {
    const pixel = wheelToZoomDelta({ deltaY: 1, ctrlKey: true, deltaMode: 0 })
    const line = wheelToZoomDelta({ deltaY: 1, ctrlKey: true, deltaMode: 1 })
    const page = wheelToZoomDelta({ deltaY: 1, ctrlKey: true, deltaMode: 2 })
    expect(line).toBeGreaterThan(pixel ?? 0)
    expect(page).toBeGreaterThan(line ?? 0)
  })
})

describe('gestureToZoomDelta', () => {
  it('maps Safari pinch-out (growing scale) to zoom-in', () => {
    expect(gestureToZoomDelta(1.1, 1)).toBeLessThan(0)
    expect(gestureToZoomDelta(0.9, 1)).toBeGreaterThan(0)
  })
})

describe('pinchToZoomDelta', () => {
  it('maps spreading fingers to zoom-in', () => {
    expect(pinchToZoomDelta(120, 100)).toBeLessThan(0)
    expect(pinchToZoomDelta(80, 100)).toBeGreaterThan(0)
  })
})

describe('keyToZoomDelta', () => {
  it('steps in on + and out on -', () => {
    expect(keyToZoomDelta('+')).toBeLessThan(0)
    expect(keyToZoomDelta('-')).toBeGreaterThan(0)
  })

  it('ignores other keys', () => {
    expect(keyToZoomDelta('a')).toBeNull()
  })
})
