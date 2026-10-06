/**
 * Source normalizers for the one zoom model (D-048). Each is pure so the
 * spike's Vitest suite can pin the signs without a browser:
 *
 * - positive delta zooms out (camera backs away), negative zooms in.
 * - pinch-out (fingers apart, content follows the fingers) zooms in.
 */

/**
 * D-060 starting points, kept as the tuned defaults (fol-j08 code part).
 * PENDING ON-DEVICE VERIFICATION (@bubbles): retune these three against a
 * real Max trackpad pinch and an iPad pinch; the device check stays open
 * after this change.
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
 * Wheel deltaMode to pixels: line and page deltas scale up to pixel space.
 */
function deltaModeScale(deltaMode: number): number {
  return deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1
}

/**
 * Chromium/Firefox pinch arrives as `wheel` with `ctrlKey`. A plain wheel
 * (two-finger swipe) is a pan (D-006) and returns null: not zoom's business.
 */
export function wheelToZoomDelta(event: WheelLike): number | null {
  if (!event.ctrlKey) return null
  const lineHeight = deltaModeScale(event.deltaMode)
  return event.deltaY * lineHeight * WHEEL_GAIN
}

export interface PanWheelLike extends WheelLike {
  deltaX: number
}

/**
 * A plain wheel (two-finger swipe) pans (D-006): pixel deltas for the rig to
 * scale into world metres like OrbitControls' own pan. A ctrl+wheel is the
 * pinch path's and returns null here.
 */
export function wheelToPan(event: PanWheelLike): { dx: number; dy: number } | null {
  if (event.ctrlKey) return null
  const lineHeight = deltaModeScale(event.deltaMode)
  const dx = event.deltaX * lineHeight
  const dy = event.deltaY * lineHeight
  if (dx === 0 && dy === 0) return null
  return { dx, dy }
}

/**
 * Safari delivers trackpad pinch as `gesturestart/change/end` with a
 * cumulative `scale` (1 at gesture start), not as ctrl+wheel. Pinch-out
 * grows the scale and zooms in.
 */
export function gestureToZoomDelta(scale: number, previousScale: number): number {
  return -(scale - previousScale) * GESTURE_GAIN
}

/**
 * Double-count guards for pinch paths that arrive on two channels at once.
 *
 * - iOS Safari fires `gesturechange` for a touch pinch alongside the pointer
 *   events the two-finger tracker already counts (fol-crx): while two touch
 *   pointers are down the pointers own the zoom.
 * - macOS Safari trackpad pinch may emit `ctrl+wheel` alongside the gesture
 *   events: while a gesture is active the gesture channel owns the zoom.
 * Both are pure so Vitest pins them; the on-device proof that neither path
 * double-counts on real hardware stays pending (fol-j08 device check).
 */
export function shouldIgnoreGestureWhilePinching(twoFingerDown: boolean): boolean {
  return twoFingerDown
}

/** While a Safari gesture is active, a ctrl+wheel for the same pinch yields. */
export function shouldIgnoreWheelDuringGesture(gestureActive: boolean): boolean {
  return gestureActive
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
