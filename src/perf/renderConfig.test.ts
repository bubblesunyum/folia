import { describe, expect, it } from 'vitest'
import { BASE_AIR, parseRenderConfig } from './renderConfig'

describe('parseRenderConfig', () => {
  it('follows the display with MSAA by default', () => {
    expect(parseRenderConfig('')).toEqual({
      dpr: [1, 1.5],
      aa: 'msaa',
      maxFps: null,
      size: null,
      budget: false,
      stress: 0,
      bloom: true,
      reflection: true,
      sway: false,
      shadowFit: 'town',
      shadowPolicy: 'live',
    })
  })

  it('pins ?perf=base to the base Air CSS size at 60 Hz', () => {
    expect(parseRenderConfig('?perf=base')).toEqual({
      dpr: 1.5,
      aa: 'msaa',
      maxFps: 60,
      size: BASE_AIR,
      budget: true,
      stress: 0,
      bloom: true,
      reflection: true,
      sway: false,
      shadowFit: 'town',
      shadowPolicy: 'live',
    })
  })

  it('drops to DPR 1.5 for MSAA and keeps DPR 2 for SMAA and none', () => {
    expect(parseRenderConfig('?aa=none')).toMatchObject({ dpr: [1, 2], aa: 'none' })
    expect(parseRenderConfig('?perf=base&aa=msaa')).toMatchObject({ dpr: 1.5, aa: 'msaa' })
    expect(parseRenderConfig('?perf=base&aa=smaa')).toMatchObject({ dpr: 2, aa: 'smaa' })
    expect(parseRenderConfig('?aa=msaa')).toMatchObject({ dpr: [1, 1.5], aa: 'msaa', size: null })
  })

  it('reads ?stress= as a whole number of extra sub-draws', () => {
    expect(parseRenderConfig('?perf=base&stress=5000')).toMatchObject({ stress: 5000 })
    for (const bad of ['-3', 'lots', '', 'Infinity', '1e999']) {
      expect(parseRenderConfig(`?stress=${bad}`)).toMatchObject({ stress: 0 })
    }
    expect(parseRenderConfig('?stress=2.7')).toMatchObject({ stress: 2 })
    expect(parseRenderConfig('?stress=20000')).toMatchObject({ stress: 16_000 })
  })

  it('ignores an unknown mode or proxy', () => {
    expect(parseRenderConfig('?aa=fxaa')).toMatchObject({ aa: 'msaa' })
    expect(parseRenderConfig('?perf=air')).toMatchObject({ size: null, budget: false })
  })

  it('turns bloom and the water reflection off on request, in either mode', () => {
    expect(parseRenderConfig('?bloom=off')).toMatchObject({ bloom: false, reflection: true })
    expect(parseRenderConfig('?perf=base&reflection=off')).toMatchObject({
      bloom: true,
      reflection: false,
    })
  })

  it('reads the spike-5 shadow knobs, defaulting to still town-live', () => {
    expect(parseRenderConfig('?sway=on&fit=vantage&shadows=static')).toMatchObject({
      sway: true,
      shadowFit: 'vantage',
      shadowPolicy: 'static',
    })
    expect(parseRenderConfig('?sway=yes&fit=wide&shadows=off')).toMatchObject({
      sway: false,
      shadowFit: 'town',
      shadowPolicy: 'live',
    })
  })
})
