// The neon shell's single-space invariant (fol-esq): inflation happens in
// object space and the facing normal takes three's batch/instance normal
// path, so a rotated instance rotates the whole shell instead of skewing it.

import { describe, expect, it } from 'vitest'
import { correctedNormal, glowOffset, IDENTITY_BASIS, neonGlow } from './neonGlow'
import type { Mat3Cols, Vec3 } from './vec'

function mat3MulVec3(m: Mat3Cols, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ]
}

/** The old buggy shell: a batch-space offset added to object-space `transformed`. */
function legacyGlowShell(p: Vec3, n: Vec3, batch: Mat3Cols, radius: number): Vec3 {
  const off = glowOffset(mat3MulVec3(batch, n), radius)
  const inflated: Vec3 = [p[0] + off[0], p[1] + off[1], p[2] + off[2]]
  return mat3MulVec3(batch, inflated)
}

/** The fixed shell: object-space inflation carried through one shared transform. */
function fixedGlowShell(p: Vec3, n: Vec3, batch: Mat3Cols, radius: number): Vec3 {
  const off = glowOffset(n, radius)
  const inflated: Vec3 = [p[0] + off[0], p[1] + off[1], p[2] + off[2]]
  return mat3MulVec3(batch, inflated)
}

/** 90° about Y as columns: maps [x, y, z] to [z, y, -x]. */
const ROT_Y_90: Mat3Cols = [
  [0, 0, -1],
  [0, 1, 0],
  [1, 0, 0],
]

describe('correctedNormal', () => {
  it('is an exact no-op under identity batching', () => {
    expect(correctedNormal([0.3, -0.8, 0.5], IDENTITY_BASIS)).toEqual([0.3, -0.8, 0.5])
  })

  it('undoes non-uniform scale before rotating, like three defaultnormal', () => {
    const basis: Mat3Cols = [
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const out = correctedNormal([2, 0, 0], basis)
    expect(out[0]).toBeCloseTo(1, 12)
    expect(out[1]).toBeCloseTo(0, 12)
    expect(out[2]).toBeCloseTo(0, 12)
  })
})

describe('glow shell space', () => {
  it('matches the legacy shell exactly under identity batching (no visual change today)', () => {
    const p: Vec3 = [4.25, 1.5, -2.75]
    const n: Vec3 = [0.3, -0.8, 0.5]
    expect(fixedGlowShell(p, n, IDENTITY_BASIS, 0.1)).toEqual(
      legacyGlowShell(p, n, IDENTITY_BASIS, 0.1),
    )
  })

  it('rotates the whole shell under a rotated instance instead of skewing it', () => {
    const p: Vec3 = [1, 0, 0]
    const n: Vec3 = [1, 0, 0]
    const fixed = fixedGlowShell(p, n, ROT_Y_90, 0.1)
    // One shared rotation of the inflated vertex: R * (p + n·r).
    expect(fixed[0]).toBeCloseTo(0, 12)
    expect(fixed[1]).toBeCloseTo(0, 12)
    expect(fixed[2]).toBeCloseTo(-1.1, 12)
    // The legacy shell double-rotates the offset, so it lands elsewhere.
    const legacy = legacyGlowShell(p, n, ROT_Y_90, 0.1)
    expect(legacy[0]).toBeCloseTo(-0.1, 12)
    expect(legacy[2]).toBeCloseTo(-1, 12)
  })
})

describe('neonGlow chunks', () => {
  it('inflates along the object-space normal and corrects the facing normal per instance', () => {
    const after = neonGlow.vertex.chunks.begin_vertex.after
    expect(after).toContain('transformed += normalize(glowNormal) * uGlowRadius')
    expect(after).not.toContain('mat3(batchingMatrix)')
    const projected = neonGlow.vertex.chunks.project_vertex.after ?? ''
    expect(projected).toContain('#ifdef USE_BATCHING')
    expect(projected).toContain('#ifdef USE_INSTANCING')
    expect(projected).toContain('normalMatrix * glowView')
  })
})
