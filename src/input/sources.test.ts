import { describe, expect, it } from 'vitest'
import {
  GESTURE_GAIN,
  gestureToZoomDelta,
  keyToZoomDelta,
  PINCH_GAIN,
  pinchToZoomDelta,
  shouldIgnoreGestureWhilePinching,
  shouldIgnoreWheelDuringGesture,
  WHEEL_GAIN,
  wheelToPan,
  wheelToZoomDelta,
} from './sources'

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

describe('fol-j08 tuned defaults', () => {
  it('keeps the D-060 gains as the defaults pending the device tune', () => {
    expect(WHEEL_GAIN).toBe(0.05)
    expect(GESTURE_GAIN).toBe(20)
    expect(PINCH_GAIN).toBe(0.05)
  })

  it('routes a touch pinch to the pointers, not the gesture channel', () => {
    expect(shouldIgnoreGestureWhilePinching(true)).toBe(true)
    expect(shouldIgnoreGestureWhilePinching(false)).toBe(false)
  })

  it('routes a trackpad pinch to the gesture, not ctrl+wheel', () => {
    expect(shouldIgnoreWheelDuringGesture(true)).toBe(true)
    expect(shouldIgnoreWheelDuringGesture(false)).toBe(false)
  })
})

describe('wheelToPan', () => {
  it('passes plain wheel pixels through as a pan', () => {
    expect(wheelToPan({ deltaX: 10, deltaY: -20, ctrlKey: false, deltaMode: 0 })).toEqual({
      dx: 10,
      dy: -20,
    })
  })

  it('yields the pinch path on ctrl+wheel and drops empty pans', () => {
    expect(wheelToPan({ deltaX: 0, deltaY: 100, ctrlKey: true, deltaMode: 0 })).toBeNull()
    expect(wheelToPan({ deltaX: 0, deltaY: 0, ctrlKey: false, deltaMode: 0 })).toBeNull()
  })

  it('scales line and page deltas up from pixels', () => {
    const pixel = wheelToPan({ deltaX: 0, deltaY: 1, ctrlKey: false, deltaMode: 0 })
    const line = wheelToPan({ deltaX: 0, deltaY: 1, ctrlKey: false, deltaMode: 1 })
    expect(pixel).not.toBeNull()
    expect(line).not.toBeNull()
    if (pixel === null || line === null) throw new Error('expected pans')
    expect(line.dy).toBeGreaterThan(pixel.dy)
  })
})
