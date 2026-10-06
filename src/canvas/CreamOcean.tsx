// The cream ocean (D-018): the opaque cream plane the town rises through.
// It mounts outside every Suspense boundary, so the first frame already shows
// sky plus cream while the town streams behind it. The town below the plane
// hides by depth; the shared reveal band tints the town just above the plane,
// so the plane tracks the driver's reveal height and hides once it parks.
//
// Its own program (MeshStandardMaterial cream, low roughness for the wet
// read, the shared height fog so the far plane melts into the sky): one more
// program the warm-up compiles behind the reveal, values never recompiled.
// The wave is a vertex-only feature — no `discard` anywhere (D-044).

import { MeshStandardMaterial } from 'three'
import { composeMaterial, type Feature } from '../materials/composer'
import { heightFog } from '../materials/heightFog'
import { worldPosition } from '../materials/worldPosition'
import { palette } from '../palette'

/** The plane's extent in metres: wider than the town camera's view at any reveal height. */
export const OCEAN_SIZE_M = 400
/** Peak wave height in metres: a swell, never chop. */
export const OCEAN_WAVE_M = 0.18

/** The shared wave uniforms: the driver owns the clock, like the sway rig. */
export const oceanUniforms = {
  /** Seconds since the reveal started; 0 parks the swell still. */
  uOceanTime: { value: 0 },
  uOceanWave: { value: OCEAN_WAVE_M },
}

/**
 * The swell: two slow sines advected in opposite directions over the plane's
 * local XY (world XZ once rotated flat). Moves no town vertices and casts
 * no shadow, so it has no depth stage.
 */
export const oceanWave = {
  key: 'ocean-wave',
  uniforms: oceanUniforms,
  vertex: {
    header: /* glsl */ `
      uniform float uOceanTime;
      uniform float uOceanWave;`,
    chunks: {
      begin_vertex: {
        after: /* glsl */ `
          float oceanPhase = position.x * 0.32 + position.y * 0.21;
          float oceanSwell = sin(oceanPhase + uOceanTime * 1.1) * 0.6
            + sin(position.y * 0.53 - uOceanTime * 0.7) * 0.4;
          transformed.z += oceanSwell * uOceanWave;`,
      },
    },
  },
} satisfies Feature

/** The ocean program, in composition order: shared world position, the swell, the fog. */
export const OCEAN_FEATURES = [
  worldPosition,
  oceanWave,
  heightFog,
] as const satisfies readonly Feature[]

/**
 * One opaque cream program for the ocean: glossy enough to read wet under
 * the env map, fogged at the horizon like everything else. Built-in fog
 * stays off — the composer's height fog owns it (D-046).
 */
export function createCreamOceanMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: palette.cream,
    roughness: 0.15,
    metalness: 0,
    fog: false,
  })
  return composeMaterial(material, [...OCEAN_FEATURES])
}
