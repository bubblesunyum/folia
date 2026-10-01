// Sway's CPU mirror (spike 5, D-041; fol-a83; fol-6di): the same phase, baked weight
// curve and offsets the GLSL in `features.ts` computes, in plain numbers so
// Vitest can pin them. The ramp edges live in
// `assets/blender/folia/foliage_params.json` — the single retune point shared
// with the Blender bake (`assets/blender/folia/foliage.py` smoothsteps each
// foliage vertex by this curve and exports it as `_SWAY`); the shader reads
// the attribute and holds no literals, so a test below asserts the chunk reads
// `_sway` and ramps on no world height.

import foliageParams from '../../assets/blender/folia/foliage_params.json' with { type: 'json' }
import type { Vec3 } from './vec'

/** Height above the clump base where the breeze starts to bite, in metres. */
export const SWAY_BASE_M: number = foliageParams.sway_base_m
/** Height above the clump base taking the full breeze, in metres. */
export const SWAY_TOP_M: number = foliageParams.sway_top_m
/** Phase drift per metre of anchor x/z. */
export const SWAY_X_RATE = 0.35
export const SWAY_Z_RATE = 0.45
/** Phase advance per second. */
export const SWAY_TIME_RATE = 1.6
/** The z wobble runs slightly off the x frequency so the motion stays elliptical. */
export const SWAY_Z_FREQ_RATIO = 0.83
/** The z wobble is weaker than x. */
export const SWAY_Z_GAIN = 0.6

/** GLSL's smoothstep: the Hermite ease between the edges, clamped outside. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * The bake curve over height above the clump base, in metres: Blender bakes
 * each foliage vertex's weight with this ramp and exports it as `_SWAY`, and
 * the shader reads the attribute directly. Trunks hold still while tops take
 * the full breeze. Batches are world-baked, so ramping on world height would
 * pin terrace foliage to its terrace — the base here is the clump's own.
 */
export function swayWeight(localY: number): number {
  return smoothstep(SWAY_BASE_M, SWAY_TOP_M, localY)
}

/** A 4x4 matrix in column-major order, matching GLSL/three layout. */
export type Mat4Elements = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

/** The identity batch: the anchor is exactly the local position. */
export const IDENTITY_BATCH: Mat4Elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mat4MulPoint(m: Mat4Elements, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

/** A translation-only batch, for tests: the per-instance origin. */
export function translationBatch(x: number, y: number, z: number): Mat4Elements {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

/**
 * Mirrors the shader's anchor: the vertex carried through the batch then the
 * instance matrix, so the per-instance origin rides along in the phase. Each
 * matrix may be null when its `USE_` flag is off.
 */
export function swayAnchor(
  position: Vec3,
  batch: Mat4Elements | null,
  instance: Mat4Elements | null,
): Vec3 {
  const afterBatch = batch ? mat4MulPoint(batch, position) : position
  return instance ? mat4MulPoint(instance, afterBatch) : afterBatch
}

/** Mirrors the shader's phase from the anchor and the clock. */
export function swayPhase(anchorX: number, anchorZ: number, time: number): number {
  return time * SWAY_TIME_RATE + anchorX * SWAY_X_RATE + anchorZ * SWAY_Z_RATE
}

/** Mirrors the shader's offsets: zero strength (or zero weight) moves nothing. */
export function swayOffset(
  phase: number,
  strength: number,
  weight: number,
): { x: number; z: number } {
  return {
    x: Math.sin(phase) * strength * weight,
    z: Math.cos(phase * SWAY_Z_FREQ_RATIO) * strength * SWAY_Z_GAIN * weight,
  }
}
