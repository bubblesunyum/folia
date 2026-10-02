// The shadow frustum math spike 5 uses (D-041): quantized extents and a
// texel-snapped light. Sizes stay powers of two so zooming between fits
// doesn't shimmer. The fit map itself lives with the URL config in
// perf/renderConfig.ts, sized per camera preset (D-058: vantage covers the
// 18 m ground disc, town unchanged); everything here takes plain metres, so
// the snap holds for every preset unchanged.

import { type DirectionalLight, Vector3 } from 'three'
import type { ShadowPolicy } from '../perf/renderConfig'

export const SHADOW_MAP_SIZE = 2048

/** Round up to a power of two, so a fit change never lands between texels (D-041). */
export function quantizeExtent(metres: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(metres, 1)))
}

/** World metres per shadow texel at this fit. */
export function texelSize(extent: number, mapSize: number): number {
  return (extent * 2) / mapSize
}

export interface ShadowRefresh {
  /** What `gl.shadowMap.autoUpdate` should be. Never `castShadow` or
   *  `shadowMap.enabled`: those recompile every program (D-043). */
  autoUpdate: boolean
  /** Whether to issue one `gl.shadowMap.needsUpdate` refresh on this pass. */
  needsRefresh: boolean
}

/**
 * The night freeze (fol-779): on the live policy the shadow map re-renders
 * every frame, including all night while the sun's intensity is 0 (spike 5:
 * 475k tris at daylight 0). So live means live-while-the-sun-is-up — sunset
 * issues one final refresh then holds frozen, sunrise restores autoUpdate.
 * The static policy keeps its D-041 re-freeze on every sun move.
 */
export function resolveShadowRefresh(
  policy: ShadowPolicy,
  daylight: number,
  wasSunUp: boolean,
): ShadowRefresh {
  if (policy === 'static') return { autoUpdate: false, needsRefresh: true }
  if (daylight > 0) return { autoUpdate: true, needsRefresh: false }
  return { autoUpdate: false, needsRefresh: wasSunUp }
}

const _right = new Vector3()
const _up = new Vector3()
const _delta = new Vector3()

/** Unsnapped base transform a snap is derived from. The rig's target base is
 *  always the scene origin; snapping is its only other writer. */
export interface ShadowSnapBase {
  position: Vector3
  target: Vector3
}

/**
 * Pure texel-snap step: the lateral shift that moves `position`'s projection
 * on the `right`/`up` axes to whole texels. Same inputs give bitwise the same
 * delta, which is what makes the snap idempotent.
 */
export function computeSnapDelta(
  position: Vector3,
  right: Vector3,
  up: Vector3,
  texel: number,
  out: Vector3,
): Vector3 {
  out.set(0, 0, 0)
  for (const axis of [right, up]) {
    const along = position.dot(axis)
    const snapped = Math.round(along / texel) * texel
    out.addScaledVector(axis, snapped - along)
  }
  return out
}

/**
 * Snaps the light and its target so the ortho frustum stays texel-aligned:
 * each one's projection on the shadow camera's right/up axes moves to a whole
 * texel. Direction is preserved — both move by the same delta.
 *
 * The snap is always derived from `base`, never from the light's current
 * (already-snapped) transform: positions reset to the base first, then the
 * shadow camera re-syncs to that base before the axes are read. So repeated
 * calls with the same base are a fixed point, and a sun sweep A→B→A lands
 * back on A instead of walking the target (the old cumulative `add` drifted,
 * because R3F re-derives `position` from the sun direction while the target
 * kept every past delta).
 */
export function snapShadowToTexels(
  light: DirectionalLight,
  extent: number,
  base: ShadowSnapBase,
): void {
  light.position.copy(base.position)
  light.target.position.copy(base.target)
  light.updateMatrixWorld()
  light.target.updateMatrixWorld()
  // The renderer's own sync (runs again at shadow render; cheap matrix math
  // here buys axes from the base instead of last frame's snapped state).
  light.shadow.updateMatrices(light)
  const texel = texelSize(extent, light.shadow.mapSize.x)
  const camera = light.shadow.camera
  _right.setFromMatrixColumn(camera.matrixWorld, 0)
  _up.setFromMatrixColumn(camera.matrixWorld, 1)
  computeSnapDelta(light.position, _right, _up, texel, _delta)
  light.position.add(_delta)
  light.target.position.add(_delta)
  light.target.updateMatrixWorld()
}
