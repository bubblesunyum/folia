import { describe, expect, it } from 'vitest'
import { damp, expFactor } from './damp'

describe('expFactor', () => {
  it('is zero for non-positive dt', () => {
    expect(expFactor(12, 0)).toBe(0)
    expect(expFactor(12, -1)).toBe(0)
  })

  it('approaches 1 for large rate*dt', () => {
    expect(expFactor(12, 10)).toBeCloseTo(1, 6)
  })
})

describe('damp', () => {
  it('holds on non-positive dt', () => {
    expect(damp(1, 5, 12, 0)).toBe(1)
  })

  it('moves toward the target', () => {
    const next = damp(0, 10, 12, 1 / 60)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(10)
  })

  it('snaps within the threshold', () => {
    expect(damp(9.9999, 10, 12, 1 / 60, 1e-3)).toBe(10)
    expect(damp(0, 10, 12, 1 / 60, 1e-3)).not.toBe(10)
  })

  it('matches the hover spring contract (rate 12, snap 1e-3)', () => {
    // One frame from rest: the same step springTowards takes.
    const rate = 12
    const dt = 1 / 60
    expect(damp(0, 0.25, rate, dt, 1e-3)).toBeCloseTo(0.25 * (1 - Math.exp(-rate * dt)), 10)
  })
})
