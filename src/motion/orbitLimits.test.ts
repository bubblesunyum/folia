import { describe, expect, it } from 'vitest'
import {
  azimuthOf,
  clampAzimuth,
  rotateOffsetY,
  wheelPanScale,
  YAW_SNAP_RAD,
  yawClampStatus,
  yawWindow,
} from './orbitLimits'

describe('azimuthOf', () => {
  it('reads the orbit azimuth off +Z', () => {
    expect(azimuthOf([0, 0, 80])).toBeCloseTo(0, 10)
    expect(azimuthOf([80, 0, 0])).toBeCloseTo(Math.PI / 2, 10)
  })
})

describe('yawWindow', () => {
  it('pins town to a point and opens neighborhoods symmetric', () => {
    expect(yawWindow(45, 0).min).toBeCloseTo(yawWindow(45, 0).max, 10)
    const window = yawWindow(45, 35)
    expect(window.min).toBeCloseTo(((45 - 35) * Math.PI) / 180, 10)
    expect(window.max).toBeCloseTo(((45 + 35) * Math.PI) / 180, 10)
  })
})

describe('yawClampStatus', () => {
  it('holds inside the window and flags outside past the snap', () => {
    const window = yawWindow(45, 35)
    const base = (45 * Math.PI) / 180
    expect(yawClampStatus(base, window, YAW_SNAP_RAD).outOfRange).toBe(false)
    const far = yawClampStatus(base + 1, window, YAW_SNAP_RAD)
    expect(far.outOfRange).toBe(true)
    expect(far.clamped).toBeCloseTo(window.max, 10)
    expect(clampAzimuth(base - 1, window.min, window.max)).toBeCloseTo(window.min, 10)
  })

  it('treats settled steps as arrived', () => {
    const window = yawWindow(45, 0)
    expect(yawClampStatus(window.min + YAW_SNAP_RAD / 2, window, YAW_SNAP_RAD).outOfRange).toBe(
      false,
    )
  })
})

describe('rotateOffsetY', () => {
  it('round-trips a rotation', () => {
    const offset = [10, 5, 40] as const
    const turned = rotateOffsetY(offset, 0.3)
    expect(Math.hypot(turned[0], turned[2])).toBeCloseTo(Math.hypot(offset[0], offset[2]), 10)
    expect(turned[1]).toBe(offset[1])
    const back = rotateOffsetY(turned, -0.3)
    expect(back[0]).toBeCloseTo(offset[0], 10)
    expect(back[2]).toBeCloseTo(offset[2], 10)
  })

  it('moves the azimuth by the delta', () => {
    const offset = [0, 0, 80] as const
    expect(azimuthOf(rotateOffsetY(offset, 0.5))).toBeCloseTo(0.5, 10)
  })
})

describe('wheelPanScale', () => {
  it('matches the OrbitControls perspective pan factor', () => {
    // OrbitControls _pan: 2 * delta * distance * tan(fov / 2) / clientHeight.
    expect(wheelPanScale(80, 800, 18)).toBeCloseTo(
      (2 * 80 * Math.tan((9 * Math.PI) / 180)) / 800,
      10,
    )
    expect(wheelPanScale(55, 800, 45)).toBeCloseTo(
      (2 * 55 * Math.tan((22.5 * Math.PI) / 180)) / 800,
      10,
    )
  })

  it('fails closed on junk viewports', () => {
    expect(wheelPanScale(80, 0, 18)).toBe(0)
    expect(wheelPanScale(Number.NaN, 800, 18)).toBe(0)
    expect(wheelPanScale(80, 800, 0)).toBe(0)
    expect(wheelPanScale(80, 800, Number.NaN)).toBe(0)
  })
})
