// Exponential damp shared by the hover spring, the panel reframe and the
// wisp ease (fol-8z6): one `1 - exp(-rate * dt)` shape, callers keep their
// own rates and snaps. Reduced motion is handled by callers, not here.

/** The approach factor for `rate` (1/s) over `dt` seconds. */
export function expFactor(rate: number, dt: number): number {
  if (dt <= 0) return 0
  return 1 - Math.exp(-rate * dt)
}

/** `current` eased toward `target`; snaps when within `snap`. */
export function damp(current: number, target: number, rate: number, dt: number, snap = 0): number {
  if (dt <= 0) return current
  const next = current + (target - current) * expFactor(rate, dt)
  return snap > 0 && Math.abs(next - target) <= snap ? target : next
}
