// The reveal's CPU mirror (D-018, D-044): the cream band is a color and
// roughness blend above `revealHeight`, never a `discard`. Parked below the
// town the mix is exactly zero, so still renders sit on the authored look;
// the reveal driver raises it with the ocean and re-parks when done.

/** Parked height in metres: below everything, so the band mix is zero. */
export const REVEAL_PARKED_M = -100000
/** Height the sweep starts at, in metres: above the town, so everything reads cream. */
export const REVEAL_START_M = 30
/** How far above the measured town top the sweep starts, in metres. */
export const REVEAL_TOP_MARGIN_M = 2
/**
 * Height the sweep settles at before parking: below grade, so the ocean hides
 * under the terrain and the driver can hide the mesh on the same tick.
 */
export const REVEAL_SETTLE_M = -2
/** The full sweep, in ms (D-018's ~2.5 s cap). */
export const REVEAL_DURATION_MS = 2500
/** The shortened sweep for repeat visits and deep links (D-018). */
export const REVEAL_SHORT_MS = 1200
/**
 * How long the driver waits for town content to settle before sweeping
 * anyway: the reveal never waits on itself, so a stalled stream still
 * resolves to the town instead of holding the ocean forever.
 */
export const REVEAL_WAIT_CAP_MS = 6000
/** How long town content must sit unchanged before the sweep starts. */
export const REVEAL_SETTLE_WAIT_MS = 400
/** sessionStorage key marking a completed reveal, so repeats read short. */
export const REVEAL_SEEN_KEY = 'folia:revealed'

/** What shortens the sweep: a repeat visit, a deep link, or reduced motion. */
export interface RevealSchedule {
  repeat: boolean
  deepLink: boolean
  reducedMotion: boolean
}

/**
 * The sweep duration in ms: 0 under reduced motion (the final state shows
 * immediately), shortened on repeat visits and deep links, capped full
 * otherwise.
 */
export function revealDurationMs(schedule: RevealSchedule): number {
  if (schedule.reducedMotion) return 0
  if (schedule.repeat || schedule.deepLink) return REVEAL_SHORT_MS
  return REVEAL_DURATION_MS
}

/** Clamped 0..1 progress of an elapsed sweep; a zero duration is already done. */
export function revealProgressAt(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1
  return Math.min(Math.max(elapsedMs / durationMs, 0), 1)
}

/**
 * Where the sweep starts for measured content: just above the town top, so
 * the visible emergence fills the sweep instead of descending through empty
 * sky. Falls back to `REVEAL_START_M` when the town is unmeasurable, and
 * never below settle plus one band (a degenerate town still sweeps).
 */
export function revealStartFor(contentTopM: number | undefined): number {
  if (contentTopM === undefined || !Number.isFinite(contentTopM)) return REVEAL_START_M
  return Math.max(contentTopM + REVEAL_TOP_MARGIN_M, REVEAL_SETTLE_M + REVEAL_BAND_M + 0.5)
}

/**
 * The reveal height partway through the sweep: from `startM` down to below
 * grade. The town emerges top-first through the opaque cream; park to
 * `REVEAL_PARKED_M` after.
 */
export function revealHeightAt(progress: number, startM: number = REVEAL_START_M): number {
  const t = Math.min(Math.max(progress, 0), 1)
  return startM + (REVEAL_SETTLE_M - startM) * t
}
/** The glossy cream band's width in metres. */
export const REVEAL_BAND_M = 0.5
/** Roughness inside the band: wet cream flowing off. */
export const REVEAL_GLOSS = 0.15

/** GLSL smoothstep mirror (see swayModel.ts): the Hermite ease, clamped outside. */
export function revealStep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** The cream mix at world height `y`: full at/below the line, fading up through the band. */
export function revealMix(y: number, height: number, band: number): number {
  return 1 - revealStep(height, height + band, y)
}
