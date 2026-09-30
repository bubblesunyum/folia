// Shared CPU-side GLSL-layout math (fol-esq follow-up): the tuple/matrix
// shapes the feature test mirrors use, so no feature module imports types
// from another feature. Mirrors column-major GLSL indexing (`m[0]` is
// column 0).

/** Three components, matching GLSL's `vec3`. */
export type Vec3 = readonly [number, number, number]

/** A 3x3 matrix as columns, matching GLSL indexing (`m[0]` is column 0). */
export type Mat3Cols = readonly [Vec3, Vec3, Vec3]

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

export function mat3MulVec3(m: Mat3Cols, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ]
}
