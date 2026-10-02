import { describe, expect, it } from 'vitest'
import { type PaletteColor, palette } from '../palette'
import { initialDraft, KEYFRAMES, linear, loadKeyframes, lookAt, resolveDraft } from './look'

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

  it('carries fog on every keyframe, distinct between golden hour and night', () => {
    for (const keyframe of KEYFRAMES) expect(keyframe.look.fog.density).toBeGreaterThan(0)
    expect(byName('golden').look.fog.color).not.toEqual(byName('night').look.fog.color)
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

  it('resolves through an override palette and rejects unknown names', () => {
    expect(linear('mint', { ...palette, mint: '#000000' })).toEqual([0, 0, 0])
    expect(() => linear('nope' as PaletteColor, palette)).toThrowError(/isn't in palette/)
  })

  it('fails closed on an unknown fog color name', () => {
    const draft = initialDraft()
    const keyframe = draft.keyframes[0]
    if (!keyframe) throw new Error('no keyframes')
    ;(keyframe.look.fog as unknown as { color: string }).color = 'nope'
    expect(() => loadKeyframes({ keyframes: draft.keyframes }, draft.palette)).toThrowError(
      /isn't in palette/,
    )
  })
})

describe('fog', () => {
  it('interpolates with the rest of the look', () => {
    const golden = byName('golden')
    const night = byName('night')
    const mid = lookAt((golden.hours + night.hours) / 2)
    expect(mid.fog.density).toBeCloseTo((golden.look.fog.density + night.look.fog.density) / 2)
    expect(mid.fog.baseHeight).toBeCloseTo(
      (golden.look.fog.baseHeight + night.look.fog.baseHeight) / 2,
    )
  })

  it('fails closed when a keyframe omits fog', () => {
    const draft = initialDraft()
    const source = draft.keyframes[0]
    if (!source) throw new Error('no keyframes')
    const { fog: _dropped, ...lookWithoutFog } = source.look
    expect(() =>
      loadKeyframes({ keyframes: [{ ...source, look: lookWithoutFog }] }, draft.palette),
    ).toThrowError(`keyframes.json: keyframe "${source.name}" is missing "fog"`)
  })
})

describe('draft', () => {
  it('starts from the files on disk', () => {
    const draft = initialDraft()
    expect(draft.palette).toEqual({ ...palette })
    expect(draft.keyframes.map((k) => k.name)).toEqual(KEYFRAMES.map((k) => k.name))
  })

  it('resolves the look through the draft palette', () => {
    const draft = initialDraft()
    draft.palette.sunlight = '#000000'
    expect(resolveDraft(draft, 18.5).sun.color).toEqual([0, 0, 0])
  })
})
