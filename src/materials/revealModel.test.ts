// The reveal band's CPU mirror: full cream at the line, fading up through
// the band, exactly zero while parked below the town.

import { describe, expect, it } from 'vitest'
import { REVEAL_BAND_M, REVEAL_GLOSS, REVEAL_PARKED_M, revealMix } from './revealModel'

describe('revealMix', () => {
  it('is zero everywhere while parked below the town (still renders rest)', () => {
    for (const y of [-50, 0, 10, 100]) {
      expect(revealMix(y, REVEAL_PARKED_M, REVEAL_BAND_M)).toBe(0)
    }
  })

  it('is full cream at the line and gone past the band', () => {
    expect(revealMix(0, 0, REVEAL_BAND_M)).toBe(1)
    expect(revealMix(REVEAL_BAND_M, 0, REVEAL_BAND_M)).toBe(0)
    expect(revealMix(REVEAL_BAND_M + 5, 0, REVEAL_BAND_M)).toBe(0)
  })

  it('eases through the band, never outside [0, 1]', () => {
    const mid = revealMix(REVEAL_BAND_M / 2, 0, REVEAL_BAND_M)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(revealMix(REVEAL_BAND_M / 4, 0, REVEAL_BAND_M)).toBeGreaterThan(mid)
    for (const y of [-10, -1, 0, 0.1, 0.4, 1, 50]) {
      const mix = revealMix(y, 0, REVEAL_BAND_M)
      expect(mix).toBeGreaterThanOrEqual(0)
      expect(mix).toBeLessThanOrEqual(1)
    }
  })

  it('keeps a thin glossy band', () => {
    expect(REVEAL_BAND_M).toBeGreaterThan(0)
    expect(REVEAL_BAND_M).toBeLessThanOrEqual(1)
    expect(REVEAL_GLOSS).toBeGreaterThan(0)
    expect(REVEAL_GLOSS).toBeLessThan(1)
  })
})
