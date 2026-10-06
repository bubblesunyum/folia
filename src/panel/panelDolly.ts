// Panel vantage dolly decision as a pure step (fol-bsw): the effect owns
// the camera, this owns the rules — the pure-core-thin-rig pattern
// (zoomModel/sources), unit-tested in Vitest.
//
// Session semantics: `restore` is the pre-open distance. It is captured on
// the first engaging open and survives everything except arrival back at it
// or the user driving (flight yield) — so reopen-mid-restore, close-mid-dolly
// and effect re-fires all do the right thing without edge detection:
//   - reopen mid-restore keeps the original restore and re-engages the goal;
//   - close mid-dolly drives back, because a surviving restore proves the
//     user never drove (any user drive clears it via the flight yield);
//   - re-fires with no state change claim nothing and freeze nothing.

import { flightAt, flightDurationMs, REFRAME_MS, tweenProgress } from '../motion/flight'
import type { PanelVariant } from './metrics'
import type { PedestalSlug } from './pedestals'

/**
 * Panel vantage distance in metres: the town camera sits at ~80 m, where the
 * wide island overflows the 800 px panel leftover. Fitting the whole island
 * would need ~107 m — past the 90 m zoom limit — so the panel takes a closer
 * subject framing instead: the ~8 m pedestal cluster fills the leftover at
 * ~50 m, and the island rims bleed deliberately. Tunable.
 */
export const PANEL_VANTAGE_M = 50
/** Below this far past the vantage the dolly engages; inside it the camera stays. */
export const PANEL_VANTAGE_MARGIN_M = 2

export interface DollyState {
  goal: number | null
  restore: number | null
}

export interface DollyInput {
  slug: PedestalSlug | null
  variant: PanelVariant
  /** Current orbit distance, or null without controls. */
  distance: number | null
  state: DollyState
}

export interface DollyDecision {
  state: DollyState
  /** Claim the camera when true: cancels in-flight zoom tweens. */
  claim: boolean
}

/** Open/close/narrow transition for the panel vantage dolly. */
export function resolvePanelDolly(input: DollyInput): DollyDecision {
  const { slug, variant, distance, state } = input
  if (slug === null) {
    // Close: drive back while a restore survives — survival itself proves
    // the user never drove. A null restore leaves any in-flight drive alone,
    // so re-fires mid-restore neither freeze nor double-claim.
    if (state.restore !== null) {
      const next: DollyState = { goal: state.restore, restore: state.restore }
      return { state: next, claim: next.goal !== state.goal }
    }
    return { state, claim: false }
  }
  if (variant !== 'side' || distance === null) {
    // Narrow or targetless: cancel any wide dolly, keep the session restore.
    if (state.goal === null) return { state, claim: false }
    return { state: { goal: null, restore: state.restore }, claim: false }
  }
  // Open, wide: engage past the margin, always overriding a stale goal
  // (reopen mid-restore); the first restore wins for the session.
  if (distance > PANEL_VANTAGE_M + PANEL_VANTAGE_MARGIN_M) {
    const next: DollyState = { goal: PANEL_VANTAGE_M, restore: state.restore ?? distance }
    return { state: next, claim: next.goal !== state.goal }
  }
  return { state, claim: false }
}

/**
 * One eased step of the vantage dolly toward its goal, on the one camera
 * easing (motion/flight) every rise and flight shares. The rig owns the
 * tween clock; this stays pure so Vitest pins the motion without a canvas.
 * Under reduced motion the step is a cut: the goal at once (fol-l7d.11).
 */
export function dollyFlightStep(
  current: number,
  goal: number,
  start: number,
  now: number,
  durationMs: number = REFRAME_MS,
  reducedMotion = false,
): number {
  return flightAt(
    current,
    goal,
    tweenProgress(start, now, flightDurationMs(durationMs, reducedMotion)),
  )
}
