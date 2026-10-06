/**
 * The quality tier ladder (D-036): four rungs from `low` to `ultra`, pure
 * enough for Vitest, with a thin rig in `TownCanvas` doing the applying.
 *
 * Stepping down, in order: the 120 Hz cap, then DPR, then shadows (intensity
 * 0 with frozen updates — `shadowMap.enabled` is never toggled, D-043), then
 * bloom, with neon's fake glow carrying the night (D-038). Stepping up spends
 * headroom on the water reflection pass, DPR 2 and a 4096 shadow map, and
 * never raises DPR above 2. 120 Hz runs only in Chromium and Firefox, and
 * only while the camera moves (the demand loop idles otherwise, R-002).
 *
 * Detection is three layers: the URL switches (`?bloom=off`,
 * `?reflection=off`, `?shadows=static`) are ceilings the probe never
 * re-enables, not a second system; the renderer string is a prior only
 * (R-003: it can't tell Apple chips apart); the frame-time probe steps down
 * and one post-reveal idle stress burst steps up. The result is cached in
 * `localStorage`, keyed by renderer string and screen.
 *
 * `?perf=base` pins the bench config: the rig no-ops there, so the D-063
 * proxy stays comparable run to run. This module is three-free (D-047).
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { RenderConfig, ShadowPolicy } from './renderConfig'
import { BENCH_SPREAD_THRESHOLD_MS, SATURATED_BUDGET_MS } from './renderConfig'

/** The ladder rungs, cheapest first. `ultra` is earned by the stress probe, never the default. */
export type QualityTierId = 'low' | 'medium' | 'high' | 'ultra'

export const TIER_ORDER: readonly QualityTierId[] = ['low', 'medium', 'high', 'ultra']

/** DPR never exceeds this, on any tier (D-036, D-050). */
export const MAX_TIER_DPR = 2

export interface QualityTier {
  id: QualityTierId
  /** A 60 Hz cap, or null for the display's rate (120 Hz only where `canRun120` allows, while moving). */
  maxFps: 60 | null
  /** The top of R3F's `[1, dprMax]` range; clamped by `MAX_TIER_DPR`. */
  dprMax: number
  /**
   * False turns the sun's shadow off via `shadow.intensity = 0` plus frozen
   * updates — never `shadowMap.enabled`, which is in every program's cache
   * key (D-043). The foliage back-light reads the stock shadow term, so
   * intensity-0 tiers render unchanged.
   */
  shadows: boolean
  /** False freezes the map (`shadowPolicy: 'static'`); `shadows: false` implies it. */
  shadowLive: boolean
  /** Shadow map edge in px; 4096 is the step-up spend. Applied by realloc, never by toggling. */
  shadowMapSize: 2048 | 4096
  /** False drops the bloom pass; night falls back to neon's fake glow (D-038). */
  bloom: boolean
  /** False skips the mirrored pass; water keeps env and Fresnel only (D-039). */
  reflection: boolean
}

export const QUALITY_LADDER: Record<QualityTierId, QualityTier> = {
  low: {
    id: 'low',
    maxFps: 60,
    dprMax: 1,
    shadows: false,
    shadowLive: false,
    shadowMapSize: 2048,
    bloom: false,
    reflection: false,
  },
  medium: {
    id: 'medium',
    maxFps: 60,
    dprMax: 1,
    shadows: true,
    shadowLive: true,
    shadowMapSize: 2048,
    bloom: true,
    reflection: false,
  },
  high: {
    id: 'high',
    maxFps: null,
    dprMax: 1.5,
    shadows: true,
    shadowLive: true,
    shadowMapSize: 2048,
    bloom: true,
    reflection: true,
  },
  ultra: {
    id: 'ultra',
    maxFps: null,
    dprMax: 2,
    shadows: true,
    shadowLive: true,
    shadowMapSize: 4096,
    bloom: true,
    reflection: true,
  },
}

export function tierById(id: QualityTierId): QualityTier {
  return QUALITY_LADDER[id]
}

/** One rung up or down, clamped at the ends: the probe calls this, never arithmetic. */
export function stepTier(id: QualityTierId, direction: -1 | 1): QualityTierId {
  const at = TIER_ORDER.indexOf(id)
  const next = Math.min(TIER_ORDER.length - 1, Math.max(0, at + direction))
  return TIER_ORDER[next] ?? id
}

/** Deltas under this mark full-rate rendering (60 Hz is 16.7 ms, 120 Hz 8.3 ms). */
export const FRAME_FAST_MS = 20
/** The ring the rig keeps; about a second at 60 Hz. */
export const FRAME_WINDOW = 60
/**
 * Fewer fast frames than this means the demand loop is idling, not
 * struggling: ambient motion ticks at ~30 Hz (33 ms deltas, D-073), so an
 * idle window must never read as jank.
 */
export const FRAME_ACTIVE_MIN_FAST = 30
/** Above this median while actively rendering, the tier can't hold its frame: step down. */
export const FRAME_STEP_DOWN_MEDIAN_MS = 19.5

export type FrameWindowClass = 'idle' | 'smooth' | 'janky'

/**
 * Reads one window of rAF deltas (ms between rendered frames). Idle covers
 * both too-few samples and a resting demand loop; only a window that is
 * mostly full-rate with a blown median steps the ladder down.
 */
export function classifyFrameWindow(deltasMs: readonly number[]): FrameWindowClass {
  if (deltasMs.length < FRAME_WINDOW) return 'idle'
  const window = deltasMs.slice(-FRAME_WINDOW)
  let fast = 0
  for (const delta of window) if (delta < FRAME_FAST_MS) fast += 1
  if (fast < FRAME_ACTIVE_MIN_FAST) return 'idle'
  const sorted = [...window].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return median > FRAME_STEP_DOWN_MEDIAN_MS ? 'janky' : 'smooth'
}

/**
 * Saturated-frame cost of stepping up, in wall ms/frame, keyed by the rung
 * stepped *from*. `high` pays the measured DPR 1.5→2 MSAA climb (1.80 →
 * 2.76, D-055) plus the 4096 shadow map; `medium` pays the DPR 1→1.5 climb
 * (sublinear from the same D-055 pair) plus the reflection pass (+0.15,
 * D-057); `low` pays bloom (+0.28, D-057) while live shadows cost nothing
 * resolvable (spike 5, D-058). Estimates, pinned here rather than spread
 * across the rig.
 */
export const UPGRADE_STEP_COST_MS: Record<QualityTierId, number> = {
  low: 0.3,
  medium: 0.6,
  high: 1.0,
  ultra: 0,
}

/**
 * True when the idle stress burst leaves room for the next rung: the measured
 * cost plus the step's price must stay under the D-063 gate minus the bench
 * spread, so a noisy run can't spend headroom twice (D-075).
 */
export function shouldStressUpgrade(stressMs: number, from: QualityTierId): boolean {
  if (from === 'ultra') return false
  return stressMs + UPGRADE_STEP_COST_MS[from] <= SATURATED_BUDGET_MS - BENCH_SPREAD_THRESHOLD_MS
}

/** True when the burst already breaks the gate at this rung: step down (the floor holds). */
export function shouldStressDowngrade(stressMs: number, tier: QualityTierId): boolean {
  return tier !== 'low' && stressMs > SATURATED_BUDGET_MS
}

/**
 * 120 Hz runs only in Chromium and Firefox on desktop (R-002, D-036): Safari
 * holds ProMotion near 60 Hz itself, and phones and tablets are never in the
 * 120 Hz tier.
 */
export function canRun120(userAgent: string): boolean {
  const ua = userAgent.toLowerCase()
  if (/iphone|ipad|ipod|android/.test(ua)) return false
  if (ua.includes('firefox')) return true
  if (!/chrome|chromium|edg/.test(ua)) return false
  return !(ua.includes('safari') && !/chrome|chromium/.test(ua))
}

/** A renderer string is a prior only (R-003): software always starts low, known-weak starts medium, rest starts high. Never ultra. */
export function priorTierForGpu(renderer: string, screenWidth: number): QualityTierId {
  const gpu = renderer.toLowerCase()
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low'
  if (screenWidth < 768 || /mali|adreno|powervr|uhd graphics|hd graphics/.test(gpu)) return 'medium'
  return 'high'
}

export const TIER_CACHE_VERSION = 'v1'

/** The cache key: renderer string plus screen, so one machine's verdict never follows another's. */
export function tierCacheKey(renderer: string, screenWidth: number, screenHeight: number): string {
  const gpu =
    renderer
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'unknown'
  return `folia:tier:${TIER_CACHE_VERSION}:${gpu}|${screenWidth}x${screenHeight}`
}

export function readCachedTier(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): QualityTierId | null {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    // The cache has always been `{ tier }` under this key (v1): anything else
    // is junk, not a legacy shape.
    const parsed: unknown = JSON.parse(raw)
    const id = (parsed as { tier?: unknown } | null)?.tier
    return (TIER_ORDER as readonly unknown[]).includes(id) ? (id as QualityTierId) : null
  } catch {
    return null
  }
}

export function writeCachedTier(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  id: QualityTierId,
): void {
  try {
    storage.setItem(key, JSON.stringify({ tier: id }))
  } catch {
    // Private mode: the probe simply runs again next visit.
  }
}

/**
 * The URL switches as tier ceilings, not a second system: whatever the URL
 * forces off, the probe never re-enables.
 */
export interface TierCeilings {
  bloom: boolean
  reflection: boolean
  shadowLive: boolean
}

export function parseTierCeilings(search: string): TierCeilings {
  const params = new URLSearchParams(search)
  return {
    bloom: params.get('bloom') !== 'off',
    reflection: params.get('reflection') !== 'off',
    shadowLive: params.get('shadows') !== 'static',
  }
}

export function applyCeilings(tier: QualityTier, ceilings: TierCeilings): QualityTier {
  return {
    ...tier,
    bloom: tier.bloom && ceilings.bloom,
    reflection: tier.reflection && ceilings.reflection,
    shadowLive: tier.shadowLive && ceilings.shadowLive,
  }
}

export interface EffectiveTierConfig {
  tier: QualityTier
  maxFps: 60 | null
  dpr: [number, number]
  bloom: boolean
  reflection: boolean
  shadowPolicy: ShadowPolicy
  /**
   * Written to the sun's `shadow.intensity`: 0 or 1. `shadowMap.enabled` is
   * never touched (D-043).
   */
  shadowIntensity: 0 | 1
  shadowMapSize: 2048 | 4096
}

/** The rung plus ceilings plus browser: everything the rigs apply, in one value. */
export function resolveEffectiveTier(
  id: QualityTierId,
  ceilings: TierCeilings,
  userAgent: string,
): EffectiveTierConfig {
  const tier = applyCeilings(tierById(id), ceilings)
  const uncapped = tier.maxFps === null && canRun120(userAgent)
  return {
    tier,
    maxFps: uncapped ? null : 60,
    dpr: [1, Math.min(tier.dprMax, MAX_TIER_DPR)],
    bloom: tier.bloom,
    reflection: tier.reflection,
    shadowPolicy: tier.shadows && tier.shadowLive ? 'live' : 'static',
    shadowIntensity: tier.shadows ? 1 : 0,
    shadowMapSize: tier.shadowMapSize,
  }
}

/**
 * The tier-effective flags shared with rigs that read per frame instead of
 * subscribing (Lights, WaterReflection): one object, already the URL
 * switches' successor.
 */
export function applyTierToRenderConfig(
  config: Pick<RenderConfig, 'bloom' | 'reflection' | 'shadowPolicy'>,
  effective: Pick<EffectiveTierConfig, 'bloom' | 'reflection' | 'shadowPolicy'>,
): void {
  config.bloom = effective.bloom
  config.reflection = effective.reflection
  config.shadowPolicy = effective.shadowPolicy
}

/** The sun's `shadow.intensity` for this rung: 0 or 1, never a program toggle. */
export function shadowIntensityFor(tier: QualityTier): 0 | 1 {
  return tier.shadows ? 1 : 0
}

/** True when the shadow map needs a realloc to this rung's size; shadow-off rungs never realloc. */
export function needsShadowMapResize(currentSize: number, tier: QualityTier): boolean {
  return tier.shadows && currentSize !== tier.shadowMapSize
}

/**
 * Reads the renderer string behind the tier cache key: the unmasked string
 * when the debug extension allows, else three's own renderer parameter.
 * Structurally typed, so this module stays three-free (D-047).
 */
export function rendererStringFor(gl: {
  getParameter(name: number): unknown
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL?: number } | null
  RENDERER: number
}): string {
  try {
    const key = gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL
    if (typeof key === 'number') {
      const masked = gl.getParameter(key)
      if (typeof masked === 'string' && masked.length > 0) return masked
    }
    const fallback = gl.getParameter(gl.RENDERER)
    return typeof fallback === 'string' && fallback.length > 0 ? fallback : 'unknown'
  } catch {
    return 'unknown'
  }
}

let currentTierId: QualityTierId = 'high'
const tierListeners = new Set<() => void>()

export function getTierId(): QualityTierId {
  return currentTierId
}

function subscribeTier(listener: () => void): () => void {
  tierListeners.add(listener)
  return () => {
    tierListeners.delete(listener)
  }
}

function notifyTier(): void {
  for (const listener of tierListeners) listener()
}

/** Moves the ladder; returns true when it changed. Subscribed rigs re-render. */
export function setTierId(id: QualityTierId): boolean {
  if (id === currentTierId) return false
  currentTierId = id
  notifyTier()
  return true
}

export function useQualityTierId(): QualityTierId {
  return useSyncExternalStore(subscribeTier, getTierId, getTierId)
}

/** The rung with ceilings and browser applied; Viewport and Effects read through this. */
export function useEffectiveTier(): EffectiveTierConfig {
  const id = useQualityTierId()
  // Window-guarded: this module is three-free and SSR-importable (D-047).
  const search = typeof window === 'undefined' ? '' : window.location.search
  const ceilings = useMemo(() => parseTierCeilings(search), [search])
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return useMemo(() => resolveEffectiveTier(id, ceilings, userAgent), [id, ceilings, userAgent])
}

/** Test escape hatch: the ladder is module state, so tests reset it between cases. */
export function resetTierStoreForTests(id: QualityTierId = 'high'): void {
  currentTierId = id
  notifyTier()
}
