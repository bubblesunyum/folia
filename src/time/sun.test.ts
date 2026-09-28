import { describe, expect, it } from 'vitest'
import { sunAt } from './sun'
import { GOLDEN_HOUR } from './timeParam'

describe('sunAt', () => {
  it('is up and bright at midday', () => {
    const sun = sunAt(13)
    expect(sun.elevation).toBeGreaterThan(1)
    expect(sun.daylight).toBe(1)
  })

  it('is low but lit at golden hour', () => {
    const sun = sunAt(GOLDEN_HOUR)
    expect(sun.elevation).toBeGreaterThan(0)
    expect(sun.elevation).toBeLessThan(0.4)
    expect(sun.daylight).toBeGreaterThan(0.5)
  })

  it('is below the horizon and dark at night', () => {
    for (const hours of [0, 3, 22, 23.9]) {
      const sun = sunAt(hours)
      expect(sun.elevation).toBeLessThan(0)
      expect(sun.daylight).toBe(0)
    }
  })

  it('returns a unit direction', () => {
    const [x, y, z] = sunAt(10).direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
  })
})
