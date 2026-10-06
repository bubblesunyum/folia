import { describe, expect, it } from 'vitest'
import {
  azimuthOf,
  clampAzimuth,
  confineOffsetToWindow,
  rotateOffsetY,
  wheelPanScale,
  windowForPreset,
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

describe('windowForPreset', () => {
  it('derives the yawWindow from a preset range, symmetric about the base', () => {
    expect(windowForPreset({ yawRangeDeg: [-35, 35] }, 45)).toEqual(yawWindow(45, 35))
    expect(windowForPreset({ yawRangeDeg: [0, 0] }, 45)).toEqual(yawWindow(45, 0))
  })

  it('pins a fixed-yaw preset to a point window', () => {
    const window = windowForPreset({ yawRangeDeg: [0, 0] }, 45)
    expect(window.min).toBeCloseTo(window.max, 10)
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

describe('confineOffsetToWindow', () => {
  it('leaves an inside offset alone and keeps radius and height on clamp', () => {
    const window = yawWindow(45, 35)
    const inside = rotateOffsetY([0, 5, 80], (45 * Math.PI) / 180)
    expect(confineOffsetToWindow(inside, window)).toBe(inside)
    const far = rotateOffsetY([0, 5, 80], Math.PI)
    const confined = confineOffsetToWindow(far, window)
    expect(azimuthOf(confined)).toBeCloseTo(window.max, 10)
    expect(Math.hypot(confined[0], confined[2])).toBeCloseTo(Math.hypot(far[0], far[2]), 10)
    expect(confined[1]).toBe(far[1])
  })

  it('holds a zero-radius offset and never crashes on NaN', () => {
    const window = yawWindow(45, 0)
    expect(confineOffsetToWindow([0, 5, 0], window)).toEqual([0, 5, 0])
    const nanOffset: [number, number, number] = [Number.NaN, 0, 0]
    expect(confineOffsetToWindow(nanOffset, window)[0]).toBeNaN()
  })
})
