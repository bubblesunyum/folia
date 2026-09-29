/** The antialiasing modes spike 3 compares (D-042). */
export type AaMode = 'none' | 'msaa' | 'smaa'

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
}

/** Base Air CSS size; the pixel buffer depends on the chosen AA mode (D-055). */
export const BASE_AIR = { width: 1280, height: 800 }
export const GPU_BUDGET_MS = 3

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
  if (params.get('perf') !== 'base') {
    return {
      dpr: [1, DPR_FOR[aa]],
      aa,
      maxFps: null,
      size: null,
      budget: false,
      stress,
    }
  }
  return { dpr: DPR_FOR[aa], aa, maxFps: 60, size: BASE_AIR, budget: true, stress }
}
