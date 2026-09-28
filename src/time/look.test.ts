import { describe, expect, it } from 'vitest'
import { KEYFRAMES, linear, lookAt } from './look'

const byName = (name: string) => {
  const keyframe = KEYFRAMES.find((k) => k.name === name)
  if (!keyframe) throw new Error(`no ${name} keyframe`)
  return keyframe
}

describe('keyframes', () => {
  it('art-direct golden hour and night, and only mark the others provisional', () => {
    expect(byName('golden').provisional).toBeUndefined()
    expect(byName('night').provisional).toBeUndefined()
    expect(KEYFRAMES.filter((k) => k.provisional).map((k) => k.name)).toEqual(['dawn', 'midday'])
  })
})

describe('lookAt', () => {
  it('returns each keyframe exactly at its hour', () => {
    for (const keyframe of KEYFRAMES) expect(lookAt(keyframe.hours)).toEqual(keyframe.look)
  })

  it('eases between neighbours', () => {
    const golden = byName('golden')
    const night = byName('night')
    const mid = lookAt((golden.hours + night.hours) / 2)
    expect(mid.night).toBeCloseTo(0.5)
    expect(mid.sun.intensity).toBeCloseTo(
      (golden.look.sun.intensity + night.look.sun.intensity) / 2,
    )
  })

  it('wraps from night through midnight to dawn', () => {
    const night = byName('night')
    const dawn = byName('dawn')
    const early = lookAt(1)
    expect(early.night).toBeLessThanOrEqual(night.look.night)
    expect(early.night).toBeGreaterThanOrEqual(dawn.look.night)
    expect(lookAt(24 + night.hours)).toEqual(night.look)
  })
})

describe('linear', () => {
  it('converts palette sRGB to linear', () => {
    expect(linear('cream')[0]).toBeCloseTo(0.905, 2)
    expect(linear('forest')).toEqual([0, expect.closeTo(0.013, 3), expect.closeTo(0.0086, 3)])
  })
})
