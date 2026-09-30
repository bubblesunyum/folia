import { describe, expect, it } from 'vitest'
import {
  ENV_REGEN_RADIANS,
  shouldRegenEnv,
  skyKey,
  sunAngleBetween,
  sunMovedEnough,
} from './envTrigger'
import { lookAt } from './look'

/** A unit direction `degrees` from +Y in the XY plane. */
const dir = (degrees: number): [number, number, number] => {
  const radians = (degrees * Math.PI) / 180
  return [Math.sin(radians), Math.cos(radians), 0]
}

describe('sunMovedEnough', () => {
  it('ignores a motionless sun', () => {
    expect(sunMovedEnough(dir(20), dir(20))).toBe(false)
  })

  it('ignores sub-degree drift', () => {
    expect(sunMovedEnough(dir(30), dir(30.5))).toBe(false)
  })

  it('fires past about a degree', () => {
    expect(sunMovedEnough(dir(30), dir(32))).toBe(true)
  })

  it('fires on large moves', () => {
    expect(sunMovedEnough(dir(0), [0, 0, 1])).toBe(true)
  })

  it('measures the angle: one degree reads as the regen threshold', () => {
    expect(sunAngleBetween(dir(10), dir(11))).toBeCloseTo(ENV_REGEN_RADIANS, 5)
  })
})

describe('skyKey', () => {
  it('is stable for one look', () => {
    expect(skyKey(lookAt(18.5))).toBe(skyKey(lookAt(18.5)))
  })

  it('moves with the sky', () => {
    expect(skyKey(lookAt(18.5))).not.toBe(skyKey(lookAt(22)))
  })

  it('ignores what never reaches the cube', () => {
    const plain = lookAt(18.5)
    const tweaked = {
      ...plain,
      bloom: { ...plain.bloom, intensity: plain.bloom.intensity + 1 },
      grade: { ...plain.grade, saturation: 9 },
      fog: { ...plain.fog, density: plain.fog.density + 1 },
      env: { ...plain.env, intensity: plain.env.intensity + 1 },
    }
    expect(skyKey(tweaked)).toBe(skyKey(plain))
  })
})

describe('shouldRegenEnv', () => {
  it('renders the first frame', () => {
    expect(shouldRegenEnv(null, dir(0), null, 'key')).toBe(true)
  })

  it('rests when nothing moved', () => {
    const direction = dir(20)
    const key = skyKey(lookAt(18.5))
    expect(shouldRegenEnv(direction, direction, key, key)).toBe(false)
  })

  it('fires when the sun moves about a degree', () => {
    const key = skyKey(lookAt(18.5))
    expect(shouldRegenEnv(dir(20), dir(25), key, key)).toBe(true)
  })

  it('fires when the sky changes under a still sun', () => {
    const direction = dir(20)
    expect(shouldRegenEnv(direction, direction, skyKey(lookAt(18.5)), skyKey(lookAt(22)))).toBe(
      true,
    )
  })
})
