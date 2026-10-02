/**
 * The one zoom model all input sources feed (D-048).
 *
 * Three sources normalize into a signed zoom delta in metres of camera
 * distance: positive zooms out (away from the target), negative zooms in.
 * The model clamps to the Place limits and turns a sustained push past the
 * far limit into a rise-one-level detent (D-006).
 */

import { readReducedMotion } from './intent'

export interface ZoomLimits {
  /** Closest the camera may come to the target, in metres. */
  minDistance: number
  /** Farthest the camera may go before the detent, in metres. */
  maxDistance: number
}

export interface ZoomState {
  /** Current camera distance to the target, in metres. */
  distance: number
  /** Accumulated push past the far limit, in metres. Releases on zoom-in. */
  overscroll: number
}

/** Metres of overscroll past the far limit that trip the detent. */
export const DETENT_THRESHOLD = 6

/**
 * The detent gives visibly (fol-etn): banked overscroll stretches the render
 * target past the far limit, so pushing feels like resistance instead of a
 * dead stop. Capped so a full push to the trip threshold shows at most
 * DETENT_GIVE_MAX metres before the rise releases it.
 */
export const DETENT_GIVE_GAIN = 0.25
export const DETENT_GIVE_MAX = 1.5

/** Render distance for a model state: clamped distance plus visible give. */
export function zoomRenderDistance(state: ZoomState): number {
  if (state.overscroll <= 0) return state.distance
  return state.distance + Math.min(state.overscroll * DETENT_GIVE_GAIN, DETENT_GIVE_MAX)
}

/**
 * The one zoom easing (fol-etn, spec: consistent easing). Discrete steps
 * (+/-/buttons) and the detent release ease with this curve over this long;
 * continuous sources (wheel/pinch/gesture) stay 1:1. Phase 2 flights reuse
 * the same curve so rising feels identical every time.
 */
export const ZOOM_STEP_DURATION_MS = 180

export function easeOutCubic(t: number): number {
  const u = Math.min(Math.max(t, 0), 1)
  return 1 - (1 - u) ** 3
}

/** Camera drift past this is someone else's move (a flight), not our easing. */
export const ZOOM_EXTERNAL_EPS = 0.05

/** Animation steps smaller than this are settled. */
export const ZOOM_SETTLE_EPS = 0.005

/**
 * Whether a discrete zoom step snaps instead of tweening (fol-582). Reduced
 * motion goes through the one shared reader (intent.readReducedMotion, safe
 * outside the browser), never a local matchMedia call; settled steps snap
 * regardless. Pure apart from the guarded reader, so Vitest pins the matrix.
 */
export function shouldSnapZoom(renderDistance: number, fromDistance: number): boolean {
  return readReducedMotion() || Math.abs(renderDistance - fromDistance) < ZOOM_SETTLE_EPS
}

/** Clamp a measured camera distance into the Place limits. */
export function clampZoomDistance(distance: number, limits: ZoomLimits): number {
  return Math.min(Math.max(distance, limits.minDistance), limits.maxDistance)
}

export interface ZoomBaseInput {
  /** Freshly measured camera distance to the target. */
  cameraDistance: number
  /** Last render target the rig left behind, or null before the first event. */
  lastRender: number | null
  /** Banked detent overscroll carried across events. */
  overscroll: number
  /** In-flight discrete tween target (a render distance), if one is active. */
  tweenTo: number | null
}

export interface ZoomBase {
  distance: number
  overscroll: number
  /** True when an in-flight tween was interrupted to take this base. */
  interrupted: boolean
  /** True when the camera moved externally, so the caller must drop the bank. */
  external: boolean
}

/**
 * Decide the model input for one zoom event (pure part of the rig's base
 * read). An in-flight tween is ours: interrupt it and resume from its target
 * so rapid steps accumulate instead of re-reading the unmoved camera. An idle
 * camera found far from the last render is someone else's move (a flight),
 * so the detent bank resets. Otherwise the clamped camera plus the kept bank.
 */
export function resolveZoomBase(input: ZoomBaseInput, limits: ZoomLimits): ZoomBase {
  if (input.tweenTo !== null) {
    return {
      distance: clampZoomDistance(input.tweenTo, limits),
      overscroll: input.overscroll,
      interrupted: true,
      external: false,
    }
  }
  if (
    input.lastRender !== null &&
    Math.abs(input.cameraDistance - input.lastRender) > ZOOM_EXTERNAL_EPS
  ) {
    return {
      distance: clampZoomDistance(input.cameraDistance, limits),
      overscroll: 0,
      interrupted: false,
      external: true,
    }
  }
  return {
    distance: clampZoomDistance(input.cameraDistance, limits),
    overscroll: input.overscroll,
    interrupted: false,
    external: false,
  }
}

export function initialZoomState(distance: number): ZoomState {
  return { distance, overscroll: 0 }
}

export interface ZoomStep {
  state: ZoomState
  /** True when this step pushed through the detent and should rise one level. */
  risen: boolean
}

/**
 * Apply one normalized zoom delta. Zoom-in past the near limit clamps;
 * zoom-out past the far limit accumulates resistance and trips the detent.
 */
export function applyZoomDelta(state: ZoomState, delta: number, limits: ZoomLimits): ZoomStep {
  if (delta === 0 || !Number.isFinite(delta)) return { state, risen: false }

  if (delta < 0) {
    // Zooming in releases any banked overscroll first (the resistance feel),
    // then moves the camera toward the near limit.
    const release = Math.min(state.overscroll, -delta)
    const overscroll = state.overscroll - release
    const remaining = delta + release
    const distance = Math.max(limits.minDistance, state.distance + remaining)
    return { state: { distance, overscroll }, risen: false }
  }

  const room = limits.maxDistance - state.distance
  if (delta <= room) {
    return { state: { distance: state.distance + delta, overscroll: 0 }, risen: false }
  }
  const overscroll = state.overscroll + (delta - Math.max(0, room))
  if (overscroll >= DETENT_THRESHOLD) {
    return {
      state: { distance: limits.maxDistance, overscroll: 0 },
      risen: true,
    }
  }
  return { state: { distance: limits.maxDistance, overscroll }, risen: false }
}
