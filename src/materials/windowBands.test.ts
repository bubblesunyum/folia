// The window-band curve (fol-snu.3): the TS mirrors pin the shape the shader
// interpolates, so the look is pinned in vitest instead of pixels. The
// brightness mirror matches the shipped shader's `windowCell * 1.37 + 11.3`
// exactly (cell (3,2) reads 0.627 both sides); the shader is behavior and the
// mirror pins it.

import { describe, expect, it } from 'vitest'
import type { Feature } from './composer'
import {
  WINDOW_BAND_F,
  WINDOW_LIT_AT,
  windowBand,
  windowBands,
  windowBrightness,
  windowHash,
  windowLit,
  windowRowF,
} from './windowBands'

describe('window bands (fol-snu.3)', () => {
  it('repeats one slit per floor row', () => {
    expect(windowRowF(0)).toBe(0)
    expect(windowRowF(1.2)).toBeCloseTo(0.5, 10)
    expect(windowBand(0.2)).toBeGreaterThan(0.9)
    expect(windowBand(1.2)).toBe(0)
    expect(windowBand(2.4 + 0.2)).toBeCloseTo(windowBand(0.2), 10)
  })

  it('keeps the slit inside its row fraction', () => {
    expect(WINDOW_BAND_F).toBeLessThan(0.5)
    expect(windowBand(2.0)).toBe(0)
  })

  it('lights most windows but leaves some dark', () => {
    let lit = 0
    const total = 40 * 10
    for (let u = 0; u < 40; u++) {
      for (let r = 0; r < 10; r++) {
        if (windowLit(u, r)) lit++
      }
    }
    const fraction = lit / total
    expect(fraction).toBeGreaterThan(0.4)
    expect(fraction).toBeLessThan(1 - WINDOW_LIT_AT + 0.1)
  })

  it('hashes deterministically in [0, 1)', () => {
    for (const [u, r] of [
      [0, 0],
      [7, 3],
      [39, 9],
    ] as const) {
      const h = windowHash(u, r)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
      expect(windowHash(u, r)).toBe(h)
    }
  })

  it('jitters lit brightness without going dark or hot', () => {
    for (let u = 0; u < 10; u++) {
      for (let r = 0; r < 4; r++) {
        const b = windowBrightness(u, r)
        expect(b).toBeGreaterThanOrEqual(0.55)
        expect(b).toBeLessThanOrEqual(1)
      }
    }
  })

  it('reads the shader constants it pins', () => {
    const emissive = windowBands.fragment?.chunks?.emissivemap_fragment?.after as string
    expect(emissive).toContain('totalEmissiveRadiance +=')
    expect(emissive).toContain('uWindowNight')
    expect(emissive).toContain('uWindowColor')
    expect(emissive).toContain('inverseTransformDirection')
    // Inert by day: zero weight and a black color until applyLook claims them.
    expect(windowBands.uniforms?.uWindowNight?.value).toBe(0)
  })

  it('reads world height and plan position from the shared varying (fol-kes.7)', () => {
    // No local-position varying of its own: instanced facades band at their
    // own world height instead of repeating one pattern per copy.
    expect((windowBands as Feature).vertex).toBeUndefined()
    expect(windowBands.requires).toContain('world-position')
    const emissive = windowBands.fragment?.chunks?.emissivemap_fragment?.after as string
    expect(emissive).toContain('vSharedWorld.y')
    expect(emissive).toContain('vSharedWorld.x + vSharedWorld.z')
    expect(emissive).not.toContain('vWindowWorld')
    expect(windowBands.fragment?.header).not.toContain('varying')
  })
})
