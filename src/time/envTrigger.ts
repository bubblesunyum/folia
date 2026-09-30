// The env-map regen trigger (D-040): the 256 px PMREM rebuild is the
// costliest part of moving the time of day, so the rig re-renders the cube
// only when the sun has moved about a degree or the sky it renders has
// changed. Pure core: directions and a sky signature in, a boolean out, so
// tests drive it without a renderer.

import type { Look } from './look'

/** The sun travel that earns a fresh env map: about 1° (D-040). */
export const ENV_REGEN_RADIANS = (1 * Math.PI) / 180

/** Radians between two unit directions; the clamped dot keeps float noise from NaNing. */
export function sunAngleBetween(a: readonly number[], b: readonly number[]): number {
  const dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

/** True once the sun has moved past `threshold` (about 1° by default). */
export function sunMovedEnough(
  prev: readonly number[],
  next: readonly number[],
  threshold: number = ENV_REGEN_RADIANS,
): boolean {
  return sunAngleBetween(prev, next) >= threshold
}

/**
 * The env-relevant slice of a look, as a comparable string: the sky gradient,
 * the sun glow, the clouds and the ground. Grade, bloom, fog, light
 * intensities and the env intensity never reach the cube (intensity applies
 * as scene.environmentIntensity), so editing them must not rebuild it.
 */
export function skyKey(look: Look): string {
  return JSON.stringify(look.sky)
}

/**
 * Whether the env map needs a re-render: always on the first frame (no
 * previous direction), otherwise when the sun moved about a degree or the
 * sky it renders changed.
 */
export function shouldRegenEnv(
  prevDirection: readonly number[] | null,
  nextDirection: readonly number[],
  prevKey: string | null,
  nextKey: string,
  threshold: number = ENV_REGEN_RADIANS,
): boolean {
  if (prevDirection === null || prevKey === null) return true
  return prevKey !== nextKey || sunMovedEnough(prevDirection, nextDirection, threshold)
}
