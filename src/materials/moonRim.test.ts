import { describe, expect, it } from 'vitest'
import { MOON_RIM_POWER, MOON_RIM_SCALE, moonRim, moonRimResponse } from './moonRim'
import { materials } from './shared'

describe('moonRimResponse', () => {
  it('is zero face-on and peaks edge-on, scaled by moon strength', () => {
    expect(moonRimResponse(1, 1.1)).toBe(0)
    expect(moonRimResponse(0, 1.1)).toBeCloseTo(1.1 * MOON_RIM_SCALE)
    expect(moonRimResponse(0, 0)).toBe(0)
    expect(moonRimResponse(0.5, 2)).toBeCloseTo(2 * 0.5 ** MOON_RIM_POWER * MOON_RIM_SCALE)
  })

  it('saturates its inputs like the GLSL', () => {
    expect(moonRimResponse(2, 1)).toBe(0)
    expect(moonRimResponse(-1, 1)).toBeCloseTo(MOON_RIM_SCALE)
  })
})

describe('moonRim', () => {
  it('defaults inert: black color, zero strength', () => {
    expect((moonRim.uniforms.uMoonRimColor.value as { r: number }).r).toBe(0)
    expect(moonRim.uniforms.uMoonRimStrength.value).toBe(0)
    expect(moonRim.key).toBe('moon-rim')
  })
})

describe('moonRim composition (fol-snu.5)', () => {
  it('rims the lit batches: cream, gold, ground and foliage', () => {
    for (const name of ['cream', 'gold', 'ground', 'foliage']) {
      const keys = materials[name]?.features.map((f) => f.key) ?? []
      expect(keys, `${name} has no moon rim`).toContain('moon-rim')
    }
  })

  it('stays out of the unlit programs: neon, glow and water', () => {
    for (const name of ['neon', 'neonGlow', 'water']) {
      const keys = materials[name]?.features.map((f) => f.key) ?? []
      expect(keys, `${name} should not rim`).not.toContain('moon-rim')
    }
  })
})
