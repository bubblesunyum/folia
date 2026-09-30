// Hover picking on the town-wide batches (D-032, D-061, fol-xo6): pure core.
// Raycast hits carry a face into the batch's merged storage; the `groupId`
// attribute at that vertex is already the global `uGroupState` slot (the pack
// step remapped it), so picking reads the slot straight off the geometry and
// a hover stays one uniform write. The R3F rig in `scene/HoverHighlight.tsx`
// owns the raycaster and the spring; everything here is plain math with tests.

/** Lift in metres and glow applied to the hovered group. */
export const HOVER_LIFT = 0.25
export const HOVER_GLOW = 0.6
/** Exponential approach rate (1/s) for the lift/glow spring: ~0.4 s to rest. */
export const HOVER_SPRING = 12

/**
 * Hover glow for `night` (0 by day, 1 at night): lift carries the day read,
 * so the emissive stays a tint until dark, then blooms with the neon (D-038:
 * hover adds more at night).
 */
export function glowForNight(night: number): number {
  return HOVER_GLOW * (0.35 + 0.65 * night)
}

/**
 * The global slot for a raycast hit vertex. `groupId` is the merged batch
 * attribute (Float32 after the load-time dequantize); the value is already a
 * global slot, so unrelated assets' reused local `_ID`s can't collide here.
 * Throws when the batch carries no group channel: fail closed, never hover
 * the whole town on a missing attribute.
 */
export function slotFromGroupId(
  getGroupId: ((vertex: number) => number | undefined) | null | undefined,
  vertex: number,
): number | null {
  if (!getGroupId) throw new Error('hover picking: batch has no groupId attribute')
  const slot = getGroupId(vertex)
  if (slot === undefined || Number.isNaN(slot)) return null
  return Math.round(slot)
}

/** Exponential damp of `current` toward `target` over `dt` seconds. */
export function springTowards(current: number, target: number, dt: number): number {
  if (dt <= 0) return current
  const t = 1 - Math.exp(-HOVER_SPRING * dt)
  const next = current + (target - current) * t
  // Snap when close so the demand loop actually rests (1 mm / 0.001 glow
  // are far below visible).
  return Math.abs(next - target) < 1e-3 ? target : next
}
