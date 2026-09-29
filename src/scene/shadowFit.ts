// The shadow frustum math spike 5 uses (D-041): quantized extents and a
// texel-snapped light. Sizes stay powers of two so zooming between fits
// doesn't shimmer. The fit map itself lives with the URL config in
// perf/renderConfig.ts; everything here takes plain metres.

import { type DirectionalLight, Vector3 } from 'three'

export const SHADOW_MAP_SIZE = 2048

/** Round up to a power of two, so a fit change never lands between texels (D-041). */
export function quantizeExtent(metres: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(metres, 1)))
}

/** World metres per shadow texel at this fit. */
export function texelSize(extent: number, mapSize: number): number {
  return (extent * 2) / mapSize
}

const _right = new Vector3()
const _up = new Vector3()
const _delta = new Vector3()

/**
 * Snaps the light and its target so the ortho frustum stays texel-aligned:
 * each one's projection on the shadow camera's right/up axes moves to a whole
 * texel. Direction is preserved — both move by the same delta. With a static
 * light-fitted frustum this is a no-op frame to frame; it pays off once the
 * frustum tracks the view, or when the sun moves under `?time=`.
 */
export function snapShadowToTexels(light: DirectionalLight, extent: number): void {
  const texel = texelSize(extent, light.shadow.mapSize.x)
  const camera = light.shadow.camera
  camera.updateMatrixWorld()
  _right.setFromMatrixColumn(camera.matrixWorld, 0)
  _up.setFromMatrixColumn(camera.matrixWorld, 1)
  _delta.set(0, 0, 0)
  for (const axis of [_right, _up]) {
    const along = light.position.dot(axis)
    const snapped = Math.round(along / texel) * texel
    _delta.addScaledVector(axis, snapped - along)
  }
  light.position.add(_delta)
  light.target.position.add(_delta)
  light.target.updateMatrixWorld()
}
