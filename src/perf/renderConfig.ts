/** The antialiasing modes spike 3 compares (D-042). */
export type AaMode = 'none' | 'msaa' | 'smaa'

/** The shadow frustum fits spike 5 compares (D-041), one per camera preset. */
export type ShadowFit = 'town' | 'vantage'

/** The shadow-map refresh policy: live every frame, or frozen (D-041). */
export type ShadowPolicy = 'live' | 'static'

/**
 * Half-extent in metres of the square shadow ortho box, per camera preset
 * (breadth sizes each fit to its preset's subject, D-058). Town stays ±16 m;
 * vantage is ±16 m so the box covers the 18 m ground disc (9 m radius)
 * instead of clipping it at ±8 m. Powers of two throughout, so switching
 * fits never lands between texels.
 */
export const SHADOW_FITS: Record<ShadowFit, number> = { town: 16, vantage: 16 }

export interface RenderConfig {
  /** A fixed DPR, or R3F's [min, max] range when the canvas follows the display. */
  dpr: number | [number, number]
  aa: AaMode
  /** Frames per second the loop is held to, or null for the display's rate. */
  maxFps: number | null
  /** A fixed canvas size in CSS pixels, or null to fill the window. */
  size: { width: number; height: number } | null
  /** Fixed-size benchmark mode; also enables the manual burst hook and HUD. */
  budget: boolean
  /** Extra tiny sub-draws added to the scene, to price one (`?stress=`). */
  stress: number
  /** Bloom in the post chain; `?bloom=off` leaves night to neon's fake glow (D-038). */
  bloom: boolean
  /** The water's mirrored neon pass; `?reflection=off` keeps env and Fresnel only (D-039). */
  reflection: boolean
  /** Ambient foliage and pond motion; `?sway=off` keeps the scene still. */
  sway: boolean
  /** Shadow frustum fit: the wide town box or the tight vantage box (spike 5, D-041). */
  shadowFit: ShadowFit
  /** Shadow refresh: live every frame, or frozen after each sun move (D-041). */
  shadowPolicy: ShadowPolicy
}

/** Base Air CSS size; the pixel buffer depends on the chosen AA mode (D-055). */
export const BASE_AIR = { width: 1280, height: 800 }
/**
 * Slice-exit budget (D-063): saturated-frame wall ms per frame on the M1 Max
 * under the default `?perf=base` (MSAA at DPR 1.5, 1920×1200), at golden hour
 * and at night. This replaces the provisional ≤3 ms direct-GPU number (D-035),
 * which Metal timer queries can't verify (D-055). Calls <100 and sub-draws
 * ≤3000 stand alongside it.
 */
export const SATURATED_BUDGET_MS = 2.5

// MSAA spends its samples at DPR 1.5; SMAA gets the full DPR 2 (D-042).
const DPR_FOR: Record<AaMode, number> = { none: 2, msaa: 1.5, smaa: 2 }
const AA_MODES: readonly AaMode[] = ['none', 'msaa', 'smaa']
const MAX_STRESS = 16_000

/**
 * The renderer setup from the URL. `?perf=base` pins the canvas to the base
 * Air's CSS size and caps it at 60 Hz, so throughput on the Max approximates
 * the Air's workload. MSAA uses a 1920×1200 buffer; the other modes use
 * 2560×1600. This is a visual comparison at equal CSS size, not equal pixels.
 * `?aa=` picks the antialiasing mode and `?stress=` adds sub-draws in either case.
 * `?bloom=off` and `?reflection=off` stand in for the low tier's night and water
 * until quality tiers exist (D-036).
 */
export function parseRenderConfig(search: string): RenderConfig {
  const params = new URLSearchParams(search)
  const requested = params.get('aa')
  // MSAA unless asked otherwise: the steadiest in motion (D-055).
  const aa = AA_MODES.find((mode) => mode === requested) ?? 'msaa'
  const requestedStress = Number(params.get('stress'))
  const stress = Number.isFinite(requestedStress)
    ? Math.min(MAX_STRESS, Math.max(0, Math.floor(requestedStress)))
    : 0
  const bloom = params.get('bloom') !== 'off'
  const reflection = params.get('reflection') !== 'off'
  const sway = params.get('sway') !== 'off'
  const shadowFit: ShadowFit = params.get('fit') === 'vantage' ? 'vantage' : 'town'
  const shadowPolicy: ShadowPolicy = params.get('shadows') === 'static' ? 'static' : 'live'
  if (params.get('perf') !== 'base') {
    return {
      dpr: [1, DPR_FOR[aa]],
      aa,
      maxFps: null,
      size: null,
      budget: false,
      stress,
      bloom,
      reflection,
      sway,
      shadowFit,
      shadowPolicy,
    }
  }
  return {
    dpr: DPR_FOR[aa],
    aa,
    maxFps: 60,
    size: BASE_AIR,
    budget: true,
    stress,
    bloom,
    reflection,
    sway,
    shadowFit,
    shadowPolicy,
  }
}
