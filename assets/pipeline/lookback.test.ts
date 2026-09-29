import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLookRequest, renderKeyframesJson, renderPaletteTs, writeLookFile } from './lookback'

const PALETTE_SOURCE = `// The single source of color.
export const palette = {
  // Brand.
  cream: '#F4EEE1',
  mint: '#4BFED2',
} as const
`

describe('renderPaletteTs', () => {
  it('replaces hex in place, keeping comments and grouping', () => {
    const out = renderPaletteTs(PALETTE_SOURCE, { cream: '#000000', mint: '#FFFFFF' })
    expect(out).toContain('// The single source of color.\n')
    expect(out).toContain("  cream: '#000000',\n")
    expect(out).toContain("  mint: '#FFFFFF',\n")
  })

  it('throws on unknown names, bad hex and missing entries', () => {
    expect(() => renderPaletteTs(PALETTE_SOURCE, { nope: '#000000' })).toThrowError(
      /unknown palette/,
    )
    expect(() => renderPaletteTs(PALETTE_SOURCE, { cream: 'red' })).toThrowError(/hex color/)
    expect(() =>
      renderPaletteTs(`export const palette = {\n} as const\n`, { cream: '#000000' }),
    ).toThrowError(/no cream entry/)
  })
})

const KEYFRAMES = [
  {
    name: 'golden',
    hours: 18.5,
    look: {
      sky: {
        zenith: 'skyZenith',
        horizon: 'skyDusk',
        ground: 'forest',
        glow: 'sunGlow',
        glowIntensity: 6,
        glowSharpness: 12,
        clouds: 0.5,
      },
      sun: { color: 'sunlight', intensity: 4.5 },
      moon: { color: 'moonlight', intensity: 0 },
      env: { intensity: 0.7 },
      night: 0,
      emissive: 1.2,
      bloom: { intensity: 0.35, threshold: 1, smoothing: 0.2 },
      grade: {
        lift: [0, 0, 0.01],
        gamma: [1, 1, 1],
        gain: [1.03, 1, 0.96],
        saturation: 1.08,
        shadowTint: 'lavender',
        highlightTint: 'tangerine',
        split: 0.025,
      },
    },
  },
]

describe('renderKeyframesJson', () => {
  it('round-trips valid keyframes as 2-space JSON', () => {
    const text = renderKeyframesJson(structuredClone(KEYFRAMES))
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ keyframes: KEYFRAMES })
  })

  it('keeps RGB triples on one line, matching biome format', () => {
    const text = renderKeyframesJson(structuredClone(KEYFRAMES))
    expect(text).toContain('"lift": [0, 0, 0.01]')
    expect(text).not.toMatch(/\[\s*-?[\d.e]+,\s*\n/)
  })

  it('rejects non-arrays and unknown palette names', () => {
    expect(() => renderKeyframesJson({})).toThrowError(/array/)
    const bad = structuredClone(KEYFRAMES)
    const golden = bad[0]
    if (!golden) throw new Error('fixture empty')
    golden.look.sun.color = 'nope'
    expect(() => renderKeyframesJson(bad)).toThrowError(/isn't in palette/)
  })
})

describe('parseLookRequest', () => {
  it('accepts either fixed file name with data', () => {
    expect(parseLookRequest({ file: 'palette', data: {} })).toEqual({ file: 'palette', data: {} })
  })

  it('rejects paths, methods-by-typo and missing data', () => {
    expect(() => parseLookRequest({ file: '../secret', data: {} })).toThrowError(/file/)
    expect(() => parseLookRequest({ file: 'palette' })).toThrowError(/data/)
    expect(() => parseLookRequest(null)).toThrowError(/file/)
  })
})

describe('writeLookFile', () => {
  it('writes both files under a root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folia-lookback-'))
    await mkdir(join(root, 'src/time'), { recursive: true })
    await writeFile(join(root, 'src/palette.ts'), PALETTE_SOURCE)
    await writeFile(join(root, 'src/time/keyframes.json'), '{}\n')
    await writeLookFile('palette', { cream: '#111111', mint: '#222222' }, root)
    await writeLookFile('keyframes', structuredClone(KEYFRAMES), root)
    expect(await readFile(join(root, 'src/palette.ts'), 'utf8')).toContain("cream: '#111111'")
    expect(JSON.parse(await readFile(join(root, 'src/time/keyframes.json'), 'utf8'))).toEqual({
      keyframes: KEYFRAMES,
    })
  })
})
