// Neon's built-in fake glow (D-038): the neon tubes drawn a second time as an
// oversized additive shell, brightest where it faces the camera and fading to
// nothing at its silhouette. With bloom off it carries the night; with bloom on
// it only softens the tube's edge.
//
// Both the inflation and the facing normal live in one consistent space.
// `transformed` is object space at `begin_vertex` (three applies the
// batch/instance/model matrices later, in `project_vertex`), so the shell
// offset is an object-space normal: a rotated instance then rotates the whole
// inflated vertex, instead of skewing it with a double-rotated offset. The
// view-space facing normal takes the same batch/instance path three's
// `defaultnormal` uses, with its own variable names (`bm`/`im` are already
// taken by `defaultnormal` in lit programs).

import type { Feature } from './composer'
import { dot3, type Mat3Cols, mat3MulVec3, normalize3, type Vec3 } from './vec'

/** The identity basis: the corrected normal is exactly its input. */
export const IDENTITY_BASIS: Mat3Cols = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** The object-space shell offset: `normalize(normal) * radius`. */
export function glowOffset(normal: Vec3, radius: number): Vec3 {
  const n = normalize3(normal)
  return [n[0] * radius, n[1] * radius, n[2] * radius]
}

/**
 * Mirrors the `project_vertex` block below: the batch/instance normal path
 * with three's inverse-scale correction, so non-uniform scaling doesn't tilt
 * the facing term. With an identity basis this is an exact no-op.
 */
export function correctedNormal(normal: Vec3, basis: Mat3Cols): Vec3 {
  const inv: Vec3 = [dot3(basis[0], basis[0]), dot3(basis[1], basis[1]), dot3(basis[2], basis[2])]
  const scaled: Vec3 = [normal[0] / inv[0], normal[1] / inv[1], normal[2] / inv[2]]
  return mat3MulVec3(basis, scaled)
}

export const neonGlow = {
  key: 'neon-glow',
  uniforms: {
    /** How far the shell stands off the tube, in metres. */
    uGlowRadius: { value: 0.1 },
    uGlowFalloff: { value: 2.5 },
  },
  vertex: {
    header: /* glsl */ `
      uniform float uGlowRadius;
      varying vec3 vGlowNormal;
      varying vec3 vGlowView;`,
    chunks: {
      // MeshBasicMaterial has no objectNormal without an env map, so read the attribute.
      // `transformed` is object space here: the offset must be too, so that
      // project_vertex carries position and offset through one shared transform.
      begin_vertex: {
        after: /* glsl */ `
          vec3 glowNormal = normal;
          transformed += normalize(glowNormal) * uGlowRadius;`,
      },
      project_vertex: {
        after: /* glsl */ `
          vec3 glowView = glowNormal;
          #ifdef USE_BATCHING
            mat3 glowBatch = mat3(batchingMatrix);
            glowView /= vec3(
              dot(glowBatch[0], glowBatch[0]),
              dot(glowBatch[1], glowBatch[1]),
              dot(glowBatch[2], glowBatch[2]));
            glowView = glowBatch * glowView;
          #endif
          #ifdef USE_INSTANCING
            mat3 glowInstance = mat3(instanceMatrix);
            glowView /= vec3(
              dot(glowInstance[0], glowInstance[0]),
              dot(glowInstance[1], glowInstance[1]),
              dot(glowInstance[2], glowInstance[2]));
            glowView = glowInstance * glowView;
          #endif
          vGlowNormal = normalize(normalMatrix * glowView);
          vGlowView = -mvPosition.xyz;`,
      },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform float uGlowFalloff;
      varying vec3 vGlowNormal;
      varying vec3 vGlowView;`,
    chunks: {
      color_fragment: {
        after: /* glsl */ `
          float facing = abs(dot(normalize(vGlowNormal), normalize(vGlowView)));
          diffuseColor.rgb *= pow(facing, uGlowFalloff);`,
      },
    },
  },
} satisfies Feature
