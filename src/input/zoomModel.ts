/**
 * The one zoom model all input sources feed (D-048).
 *
 * Three sources normalize into a signed zoom delta in metres of camera
 * distance: positive zooms out (away from the target), negative zooms in.
 * The model clamps to the Place limits and turns a sustained push past the
 * far limit into a rise-one-level detent (D-006).
 */

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
