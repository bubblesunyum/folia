// The one camera easing every rise and flight shares (spec: Navigation,
// D-006/D-007/D-008, D-048). Discrete camera motion — zoom steps, the detent
// release, place flights, the panel reframe — tweens over a fixed duration
// with this curve; continuous sources (wheel/pinch/gesture) stay 1:1.
// Reduced motion is honored by callers (they snap), never here. Pure and
// three-free so Vitest pins it without a canvas.

/** The single ease curve for all camera flights: fast start, soft landing. */
export function flightEase(t: number): number {
  const u = Math.min(Math.max(t, 0), 1)
  return 1 - (1 - u) ** 3
}

/** Discrete zoom steps (+/-/buttons, detent release) settle this fast. */
export const ZOOM_STEP_MS = 180
/** A rise or place flight lands within this long. */
export const PLACE_FLIGHT_MS = 900
/** The panel reframe (focus + vantage dolly) lands within this long. */
export const REFRAME_MS = 750
/** The panel view-offset ease lands within this long. */
export const OFFSET_MS = 450
/** A user-orbited yaw springs back to its preset within this long. */
export const YAW_SPRING_MS = 600

/** Animation progress smaller than this is settled. */
export const FLIGHT_SETTLE_EPS = 0.005

/** Clamped 0..1 progress of a tween started at `start` (ms, same clock). */
export function tweenProgress(start: number, now: number, durationMs: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(now) || !Number.isFinite(durationMs)) return 1
  if (durationMs <= 0) return 1
  return Math.min(Math.max((now - start) / durationMs, 0), 1)
}

/**
 * One eased step of a fixed-duration flight: `from` at progress 0, `to` at
 * progress 1, on the one easing in between. Callers snap on reduced motion
 * instead of calling this.
 */
export function flightAt(from: number, to: number, progress: number): number {
  return from + (to - from) * flightEase(progress)
}

/** Minimal vector surface for flightVec3: xyz plus copy + lerp (THREE.Vector3 qualifies). */
export interface FlightVec3 {
  x: number
  y: number
  z: number
  copy(v: FlightVec3): unknown
  lerp(v: FlightVec3, t: number): unknown
}

/**
 * The vector form of the one easing: the focus flight's shared stepper, so
 * it reads as one call instead of a copy plus a lerp over a scalar step.
 */
export function flightVec3<T extends FlightVec3>(out: T, from: T, to: T, progress: number): T {
  out.copy(from)
  out.lerp(to, flightEase(progress))
  return out
}

/** True once a tween's progress has run out (or its clock is junk). */
export function flightSettled(start: number, now: number, durationMs: number): boolean {
  return tweenProgress(start, now, durationMs) >= 1
}
