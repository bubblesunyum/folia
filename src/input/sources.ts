/**
 * Source normalizers for the one zoom model (D-048). Each is pure so the
 * spike's Vitest suite can pin the signs without a browser:
 *
 * - positive delta zooms out (camera backs away), negative zooms in.
 * - pinch-out (fingers apart, content follows the fingers) zooms in.
 */

export const WHEEL_GAIN = 0.05
export const GESTURE_GAIN = 20
export const PINCH_GAIN = 0.05
/** One `+` / `-` key step, in metres of camera distance. */
export const KEY_STEP = 4

/**
 * Window events between the shell affordance and the canvas rig. They live in
 * this pure module (not in the rig component) so DOM-only code like the zoom
 * buttons never pulls three or R3F into its module graph (D-047).
 */
export const ZOOM_IN_EVENT = 'folia:zoom-in'
export const ZOOM_OUT_EVENT = 'folia:zoom-out'
export const RISE_EVENT = 'folia:rise'

interface WheelLike {
  deltaY: number
  ctrlKey: boolean
  /** DOM_DELTA_PIXEL (0), DOM_DELTA_LINE (1) or DOM_DELTA_PAGE (2). */
  deltaMode: number
}

/**
 * Chromium/Firefox pinch arrives as `wheel` with `ctrlKey`. A plain wheel
 * (two-finger swipe) is a pan (D-006) and returns null: not zoom's business.
 */
export function wheelToZoomDelta(event: WheelLike): number | null {
  if (!event.ctrlKey) return null
  const lineHeight = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
  return event.deltaY * lineHeight * WHEEL_GAIN
}

/**
 * Safari delivers trackpad pinch as `gesturestart/change/end` with a
 * cumulative `scale` (1 at gesture start), not as ctrl+wheel. Pinch-out
 * grows the scale and zooms in.
 */
export function gestureToZoomDelta(scale: number, previousScale: number): number {
  return -(scale - previousScale) * GESTURE_GAIN
}

/** iPad two-pointer pinch, from finger distance in CSS pixels. */
export function pinchToZoomDelta(current: number, previous: number): number {
  return -(current - previous) * PINCH_GAIN
}

/** `+` / `-` keys keep mouse-wheel users from getting stuck (D-048). */
export function keyToZoomDelta(key: string): number | null {
  if (key === '+' || key === '=') return -KEY_STEP
  if (key === '-' || key === '_') return KEY_STEP
  return null
}
