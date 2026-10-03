// One shared world-position varying (fol-kes.7): the final `transformed`
// vertex through the batch/instance/model path, declared exactly once per
// program. Fog, window bands, reveal and foliage all read `vSharedWorld`
// in the fragment and declare nothing themselves, so instanced housing can
// never repeat one window pattern per copy and no program carries two
// copies of the same varying.
//
// The read is at `worldpos_vertex` off `transformed`, never `position`: the
// group lift and sway deform `transformed` at `begin_vertex`, which runs
// earlier in the shader, so the varying always sees the lifted/swayed
// vertex. The batch -> instance -> model order mirrors three's own
// `worldpos_vertex`/`project_vertex` chunks. The temp is `sharedWorldPos`,
// not three's `worldPosition`, so it can never collide with the chunk's
// conditional local. Color only: no depth stage, so shadows never move.

import type { Feature } from './composer'

/** The shared varying every world-space consumer reads. */
export const WORLD_POSITION_VARYING = 'vSharedWorld'

export const worldPosition = {
  key: 'world-position',
  vertex: {
    header: `varying vec3 ${WORLD_POSITION_VARYING};`,
    chunks: {
      worldpos_vertex: {
        after: /* glsl */ `
          vec4 sharedWorldPos = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            sharedWorldPos = batchingMatrix * sharedWorldPos;
          #endif
          #ifdef USE_INSTANCING
            sharedWorldPos = instanceMatrix * sharedWorldPos;
          #endif
          vSharedWorld = (modelMatrix * sharedWorldPos).xyz;`,
      },
    },
  },
  fragment: {
    header: `varying vec3 ${WORLD_POSITION_VARYING};`,
  },
} satisfies Feature
