import { describe, expect, it } from 'vitest'
import { SHADOW_FITS } from '../perf/renderConfig'
import { quantizeExtent, SHADOW_MAP_SIZE, texelSize } from './shadowFit'

describe('shadow fits', () => {
  it('rounds extents up to a power of two', () => {
    expect(quantizeExtent(16)).toBe(16)
    expect(quantizeExtent(9)).toBe(16)
    expect(quantizeExtent(8)).toBe(8)
  })

  it('sizes texels from the fit at 2048', () => {
    expect(texelSize(SHADOW_FITS.town, SHADOW_MAP_SIZE)).toBeCloseTo(0.0156, 4)
    expect(texelSize(SHADOW_FITS.vantage, SHADOW_MAP_SIZE)).toBeCloseTo(0.0078, 4)
  })
})
