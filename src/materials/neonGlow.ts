// Neon's built-in fake glow (D-038): the neon tubes drawn a second time as an
// oversized additive shell, brightest where it faces the camera and fading to
// nothing at its silhouette. With bloom off it carries the night; with bloom on
// it only softens the tube's edge.

import type { Feature } from './composer'

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
      begin_vertex: {
        after: /* glsl */ `
          vec3 glowNormal = normal;
          #ifdef USE_BATCHING
            glowNormal = mat3(batchingMatrix) * glowNormal;
          #endif
          transformed += normalize(glowNormal) * uGlowRadius;`,
      },
      project_vertex: {
        after: /* glsl */ `
          vGlowNormal = normalize(normalMatrix * glowNormal);
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
