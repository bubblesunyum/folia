import { describe, expect, it } from 'vitest'
import {
  type FlightVec3,
  flightAt,
  flightEase,
  flightSettled,
  flightVec3,
  OFFSET_MS,
  PLACE_FLIGHT_MS,
  REFRAME_MS,
  tweenProgress,
  YAW_SPRING_MS,
  ZOOM_STEP_MS,
} from './flight'

describe('flightEase', () => {
  it('eases out from 0 to 1', () => {
    expect(flightEase(0)).toBe(0)
    expect(flightEase(1)).toBe(1)
    expect(flightEase(0.5)).toBeGreaterThan(0.5)
  })

  it('clamps outside the unit interval', () => {
    expect(flightEase(-1)).toBe(0)
    expect(flightEase(2)).toBe(1)
  })
})

describe('flight durations', () => {
  it('keeps discrete steps instant and flights under a second', () => {
    expect(ZOOM_STEP_MS).toBeLessThanOrEqual(250)
    expect(OFFSET_MS).toBeLessThanOrEqual(REFRAME_MS)
    expect(REFRAME_MS).toBeLessThanOrEqual(PLACE_FLIGHT_MS)
    expect(PLACE_FLIGHT_MS).toBeLessThanOrEqual(1000)
    expect(YAW_SPRING_MS).toBeLessThanOrEqual(PLACE_FLIGHT_MS)
  })
})

describe('tweenProgress', () => {
  it('runs 0 to 1 across the duration', () => {
    expect(tweenProgress(1000, 1000, 500)).toBe(0)
    expect(tweenProgress(1000, 1250, 500)).toBe(0.5)
    expect(tweenProgress(1000, 1500, 500)).toBe(1)
  })

  it('clamps past the end and settles junk clocks', () => {
    expect(tweenProgress(1000, 2000, 500)).toBe(1)
    expect(tweenProgress(1000, 500, 500)).toBe(0)
    expect(tweenProgress(1000, 1250, 0)).toBe(1)
    expect(tweenProgress(Number.NaN, 1250, 500)).toBe(1)
  })
})

describe('flightAt', () => {
  it('lands on the endpoints and eases between', () => {
    expect(flightAt(50, 80, 0)).toBe(50)
    expect(flightAt(50, 80, 1)).toBe(80)
    expect(flightAt(50, 80, 0.5)).toBeGreaterThan(65)
    expect(flightAt(50, 80, 0.5)).toBeLessThan(80)
  })
})

describe('flightSettled', () => {
  it('settles at and past the duration', () => {
    expect(flightSettled(1000, 1200, 500)).toBe(false)
    expect(flightSettled(1000, 1500, 500)).toBe(true)
    expect(flightSettled(1000, 9000, 500)).toBe(true)
  })
})

describe('flightVec3', () => {
  interface FakeVec extends FlightVec3 {
    x: number
    y: number
    z: number
  }
  const vec = (x: number, y: number, z: number): FakeVec => ({
    x,
    y,
    z,
    copy(o: FlightVec3) {
      const p = o as unknown as FakeVec
      this.x = p.x
      this.y = p.y
      this.z = p.z
      return this
    },
    lerp(o: FlightVec3, t: number) {
      const p = o as unknown as FakeVec
      this.x += (p.x - this.x) * t
      this.y += (p.y - this.y) * t
      this.z += (p.z - this.z) * t
      return this
    },
  })

  it('lands on the endpoints and eases between', () => {
    const at0 = vec(0, 0, 0)
    flightVec3(at0, vec(50, 0, 0), vec(80, 10, 0), 0)
    expect([at0.x, at0.y, at0.z]).toEqual([50, 0, 0])
    const at1 = vec(0, 0, 0)
    flightVec3(at1, vec(50, 0, 0), vec(80, 10, 0), 1)
    expect([at1.x, at1.y, at1.z]).toEqual([80, 10, 0])
    const mid = vec(0, 0, 0)
    flightVec3(mid, vec(50, 0, 0), vec(80, 10, 0), 0.5)
    expect(mid.x).toBeGreaterThan(65)
    expect(mid.x).toBeLessThan(80)
  })
})
