// The reveal band's CPU mirror: full cream at the line, fading up through
// the band, exactly zero while parked below the town.

import { describe, expect, it } from 'vitest'
import {
  REVEAL_BAND_M,
  REVEAL_DURATION_MS,
  REVEAL_GLOSS,
  REVEAL_PARKED_M,
  REVEAL_SETTLE_M,
  REVEAL_SHORT_MS,
  REVEAL_START_M,
  REVEAL_TOP_MARGIN_M,
  revealDurationMs,
  revealHeightAt,
  revealMix,
  revealProgressAt,
  revealStartFor,
} from './revealModel'

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

describe('revealDurationMs', () => {
  it('caps the full sweep at about 2.5 s', () => {
    expect(REVEAL_DURATION_MS).toBe(2500)
    expect(revealDurationMs({ repeat: false, deepLink: false, reducedMotion: false })).toBe(
      REVEAL_DURATION_MS,
    )
  })

  it('shortens the sweep on repeat visits and deep links', () => {
    expect(REVEAL_SHORT_MS).toBeLessThan(REVEAL_DURATION_MS)
    expect(revealDurationMs({ repeat: true, deepLink: false, reducedMotion: false })).toBe(
      REVEAL_SHORT_MS,
    )
    expect(revealDurationMs({ repeat: false, deepLink: true, reducedMotion: false })).toBe(
      REVEAL_SHORT_MS,
    )
  })

  it('cuts the sweep under reduced motion: the final state shows immediately', () => {
    expect(revealDurationMs({ repeat: false, deepLink: false, reducedMotion: true })).toBe(0)
    expect(revealDurationMs({ repeat: true, deepLink: true, reducedMotion: true })).toBe(0)
  })
})

describe('revealProgressAt', () => {
  it('clamps outside [0, 1] and finishes a zero duration at once', () => {
    expect(revealProgressAt(-10, 2500)).toBe(0)
    expect(revealProgressAt(0, 2500)).toBe(0)
    expect(revealProgressAt(1250, 2500)).toBe(0.5)
    expect(revealProgressAt(2500, 2500)).toBe(1)
    expect(revealProgressAt(9999, 2500)).toBe(1)
    expect(revealProgressAt(0, 0)).toBe(1)
  })
})

describe('revealHeightAt', () => {
  it('sweeps from above the town to below grade, parking after', () => {
    expect(REVEAL_START_M).toBeGreaterThan(0)
    expect(REVEAL_SETTLE_M).toBeLessThan(0)
    expect(revealHeightAt(0)).toBe(REVEAL_START_M)
    expect(revealHeightAt(1)).toBe(REVEAL_SETTLE_M)
    // Monotonic descent: the town emerges top-first through the cream.
    expect(revealHeightAt(0.5)).toBeGreaterThan(revealHeightAt(0.75))
    expect(revealHeightAt(0.25)).toBeGreaterThan(revealHeightAt(0.5))
  })

  it('starts the sweep just above the measured town top', () => {
    expect(revealStartFor(12)).toBe(12 + REVEAL_TOP_MARGIN_M)
    // Unmeasurable content falls back to the safe ceiling.
    expect(revealStartFor(undefined)).toBe(REVEAL_START_M)
    expect(revealStartFor(Number.NaN)).toBe(REVEAL_START_M)
    // A degenerate town still sweeps through a band.
    const floor = revealStartFor(-100)
    expect(floor).toBeGreaterThan(REVEAL_SETTLE_M + REVEAL_BAND_M)
    expect(revealHeightAt(0, 14)).toBe(14)
    expect(revealHeightAt(1, 14)).toBe(REVEAL_SETTLE_M)
  })

  it('starts above the band and settles below it, so the sweep covers the town', () => {
    expect(revealMix(REVEAL_START_M, REVEAL_START_M, REVEAL_BAND_M)).toBe(1)
    for (const y of [0, 5, 12]) {
      expect(revealMix(y, REVEAL_START_M, REVEAL_BAND_M)).toBe(1)
      expect(revealMix(y, REVEAL_SETTLE_M, REVEAL_BAND_M)).toBe(0)
    }
    expect(REVEAL_PARKED_M).toBeLessThan(REVEAL_SETTLE_M)
  })
})
