import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyCeilings,
  applyTierToRenderConfig,
  canRun120,
  classifyFrameWindow,
  FRAME_WINDOW,
  MAX_TIER_DPR,
  needsShadowMapResize,
  parseTierCeilings,
  priorTierForGpu,
  QUALITY_LADDER,
  readCachedTier,
  rendererStringFor,
  resolveEffectiveTier,
  shadowIntensityFor,
  shouldStressDowngrade,
  shouldStressUpgrade,
  stepTier,
  TIER_ORDER,
  tierById,
  tierCacheKey,
  writeCachedTier,
} from './qualityTiers'
import { SATURATED_BUDGET_MS } from './renderConfig'

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'

const OPEN_CEILINGS = { bloom: true, reflection: true, shadowLive: true }

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('the ladder (D-036)', () => {
  it('runs low to ultra with high as the boot rung', () => {
    expect(TIER_ORDER).toEqual(['low', 'medium', 'high', 'ultra'])
    expect(tierById('high')).toBe(QUALITY_LADDER.high)
  })

  it('pins every rung: the down order is cap, DPR, shadows, bloom', () => {
    expect(QUALITY_LADDER.low).toEqual({
      id: 'low',
      maxFps: 60,
      dprMax: 1,
      shadows: false,
      shadowLive: false,
      shadowMapSize: 2048,
      bloom: false,
      reflection: false,
    })
    expect(QUALITY_LADDER.medium).toEqual({
      id: 'medium',
      maxFps: 60,
      dprMax: 1,
      shadows: true,
      shadowLive: true,
      shadowMapSize: 2048,
      bloom: true,
      reflection: false,
    })
    expect(QUALITY_LADDER.high).toEqual({
      id: 'high',
      maxFps: null,
      dprMax: 1.5,
      shadows: true,
      shadowLive: true,
      shadowMapSize: 2048,
      bloom: true,
      reflection: true,
    })
    expect(QUALITY_LADDER.ultra).toEqual({
      id: 'ultra',
      maxFps: null,
      dprMax: 2,
      shadows: true,
      shadowLive: true,
      shadowMapSize: 4096,
      bloom: true,
      reflection: true,
    })
  })

  it('never raises DPR above 2', () => {
    expect(MAX_TIER_DPR).toBe(2)
    for (const id of TIER_ORDER) {
      expect(tierById(id).dprMax).toBeLessThanOrEqual(MAX_TIER_DPR)
      expect(resolveEffectiveTier(id, OPEN_CEILINGS, CHROME_UA).dpr[1]).toBeLessThanOrEqual(2)
    }
  })

  it('steps one rung at a time and holds at the ends', () => {
    expect(stepTier('high', 1)).toBe('ultra')
    expect(stepTier('high', -1)).toBe('medium')
    expect(stepTier('ultra', 1)).toBe('ultra')
    expect(stepTier('low', -1)).toBe('low')
  })
})

describe('120 Hz gating (R-002, D-036)', () => {
  it('uncaps Chromium and Firefox, caps Safari and handhelds', () => {
    expect(canRun120(CHROME_UA)).toBe(true)
    expect(canRun120(FIREFOX_UA)).toBe(true)
    expect(canRun120(SAFARI_UA)).toBe(false)
    expect(canRun120('')).toBe(false)
  })

  it('holds uncapped tiers at 60 Hz where 120 Hz is disallowed', () => {
    expect(resolveEffectiveTier('high', OPEN_CEILINGS, CHROME_UA).maxFps).toBe(null)
    expect(resolveEffectiveTier('ultra', OPEN_CEILINGS, CHROME_UA).maxFps).toBe(null)
    expect(resolveEffectiveTier('high', OPEN_CEILINGS, SAFARI_UA).maxFps).toBe(60)
    expect(resolveEffectiveTier('ultra', OPEN_CEILINGS, SAFARI_UA).maxFps).toBe(60)
  })
})

describe('frame-time probe (step down)', () => {
  const at60 = new Array(FRAME_WINDOW).fill(1000 / 60)
  const at120 = new Array(FRAME_WINDOW).fill(1000 / 120)
  const ambient30 = new Array(FRAME_WINDOW).fill(1000 / 30)
  const janky60 = Array.from({ length: FRAME_WINDOW }, (_, i) =>
    i % 2 === 0 ? 1000 / 60 : 1000 / 30,
  )

  it('reads smooth 60 and 120 Hz windows as smooth', () => {
    expect(classifyFrameWindow(at60)).toBe('smooth')
    expect(classifyFrameWindow(at120)).toBe('smooth')
  })

  it('reads the resting demand loop as idle, never jank', () => {
    expect(classifyFrameWindow(ambient30)).toBe('idle')
    expect(classifyFrameWindow(at60.slice(0, FRAME_WINDOW - 1))).toBe('idle')
  })

  it('reads sustained missed vsyncs as jank', () => {
    expect(classifyFrameWindow(janky60)).toBe('janky')
    // A 120 Hz tier falling over: half the frames land, the rest miss wide.
    const janky120 = Array.from({ length: FRAME_WINDOW }, (_, i) => (i % 2 === 0 ? 1000 / 120 : 25))
    expect(classifyFrameWindow(janky120)).toBe('janky')
  })
})

describe('idle stress probe (step up, R-003)', () => {
  it('upgrades only with headroom for the next rung under the gate', () => {
    // High to ultra costs ~1.0 ms (D-055), so the burst must read ≤1.25 ms.
    expect(shouldStressUpgrade(1.2, 'high')).toBe(true)
    expect(shouldStressUpgrade(1.4, 'high')).toBe(false)
    expect(shouldStressUpgrade(1.5, 'medium')).toBe(true)
    expect(shouldStressUpgrade(1.8, 'medium')).toBe(false)
    expect(shouldStressUpgrade(1.0, 'low')).toBe(true)
    expect(shouldStressUpgrade(1.0, 'ultra')).toBe(false)
  })

  it('downgrades a rung that already breaks the gate, and holds the floor', () => {
    expect(shouldStressDowngrade(SATURATED_BUDGET_MS + 0.1, 'high')).toBe(true)
    expect(shouldStressDowngrade(SATURATED_BUDGET_MS + 0.1, 'low')).toBe(false)
    expect(shouldStressDowngrade(1.5, 'medium')).toBe(false)
  })
})

describe('prior, cache and ceilings', () => {
  it('uses the renderer string as a prior only: software low, weak medium, rest high, never ultra', () => {
    expect(
      priorTierForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero))', 1920),
    ).toBe('low')
    expect(priorTierForGpu('Mali-G710', 1920)).toBe('medium')
    expect(priorTierForGpu('Apple M1 Max', 500)).toBe('medium')
    expect(priorTierForGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)', 1920)).toBe('high')
    expect(priorTierForGpu('NVIDIA GeForce RTX 4090', 2560)).toBe('high')
  })

  it('keys the cache by renderer and screen', () => {
    const a = tierCacheKey('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)', 1512, 982)
    const b = tierCacheKey('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)', 1440, 900)
    const c = tierCacheKey('NVIDIA GeForce RTX 4090', 1512, 982)
    expect(a).toContain('1512x982')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('round-trips the cache and rejects junk', () => {
    const storage = fakeStorage()
    const key = tierCacheKey('Apple M1 Max', 1512, 982)
    expect(readCachedTier(storage, key)).toBe(null)
    writeCachedTier(storage, key, 'low')
    expect(readCachedTier(storage, key)).toBe('low')
    expect(readCachedTier(fakeStorage({ [key]: '"ultra-wide"' }), key)).toBe(null)
    expect(readCachedTier(fakeStorage({ [key]: 'not json' }), key)).toBe(null)
    expect(readCachedTier(fakeStorage({ [key]: JSON.stringify({ tier: 'medium' }) }), key)).toBe(
      'medium',
    )
  })

  it('reads the renderer string unmasked when allowed, masked otherwise', () => {
    const unmasked = rendererStringFor({
      getParameter: (name: number) => (name === 37445 ? 'Apple M1 Max' : 'WebKit WebGL'),
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37445 }),
      RENDERER: 37446,
    })
    expect(unmasked).toBe('Apple M1 Max')
    const masked = rendererStringFor({
      getParameter: () => 'WebKit WebGL',
      getExtension: () => null,
      RENDERER: 37446,
    })
    expect(masked).toBe('WebKit WebGL')
  })

  it('treats the URL switches as ceilings the probe never re-enables', () => {
    expect(parseTierCeilings('?bloom=off&reflection=off&shadows=static')).toEqual({
      bloom: false,
      reflection: false,
      shadowLive: false,
    })
    expect(parseTierCeilings('')).toEqual({ bloom: true, reflection: true, shadowLive: true })
    const capped = applyCeilings(tierById('ultra'), {
      bloom: false,
      reflection: false,
      shadowLive: false,
    })
    expect(capped).toMatchObject({ bloom: false, reflection: false, shadowLive: false })
    const open = applyCeilings(tierById('low'), OPEN_CEILINGS)
    expect(open).toEqual(tierById('low'))
  })
})

describe('applying a rung', () => {
  it('writes the shared render flags the per-frame rigs already read', () => {
    const config = { bloom: true, reflection: true, shadowPolicy: 'live' as const }
    applyTierToRenderConfig(config, resolveEffectiveTier('low', OPEN_CEILINGS, CHROME_UA))
    expect(config).toEqual({ bloom: false, reflection: false, shadowPolicy: 'static' })
  })

  it('freezes shadow updates whenever shadows or liveness drop', () => {
    expect(resolveEffectiveTier('low', OPEN_CEILINGS, CHROME_UA).shadowPolicy).toBe('static')
    expect(resolveEffectiveTier('high', OPEN_CEILINGS, CHROME_UA).shadowPolicy).toBe('live')
    expect(
      resolveEffectiveTier('high', { ...OPEN_CEILINGS, shadowLive: false }, CHROME_UA).shadowPolicy,
    ).toBe('static')
  })

  it('kills shadows with intensity, and only reallocs the map while lit', () => {
    expect(shadowIntensityFor(tierById('low'))).toBe(0)
    expect(shadowIntensityFor(tierById('high'))).toBe(1)
    expect(needsShadowMapResize(2048, tierById('ultra'))).toBe(true)
    expect(needsShadowMapResize(4096, tierById('ultra'))).toBe(false)
    expect(needsShadowMapResize(1024, tierById('low'))).toBe(false)
  })

  it('kills shadows through intensity, never the enabled flag (D-043)', () => {
    for (const file of [
      './qualityTiers.ts',
      '../renderer/Effects.tsx',
      '../renderer/Viewport.tsx',
      '../canvas/TownCanvas.tsx',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toMatch(/shadowMap\.enabled\s*=/)
    }
    const rig = readFileSync(new URL('../canvas/TownCanvas.tsx', import.meta.url), 'utf8')
    expect(rig).toContain('sun.shadow.intensity = effective.shadowIntensity')
  })
})
