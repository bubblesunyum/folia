// Orbit-distance writes shared by the zoom and panel rigs (fol-bsw): place
// the camera on its orbit ray at a distance from the target. Pure three
// math, no store, no loop — callers own invalidation. Canvas-only.

import * as THREE from 'three'

/** Arbitrary non-degenerate axis, so the dolly direction can never NaN. */
export const FALLBACK_ORBIT_DIRECTION = new THREE.Vector3(1, 0.6, 1).normalize()

export interface OrbitControlsLike {
  target: THREE.Vector3
  update: () => void
}

/** Scratch dolly direction, reused every drive while a tween is active. */
const scratchDirection = new THREE.Vector3()

/** Move the camera along its current orbit ray to `distance` from `target`. */
export function setOrbitDistance(
  camera: THREE.Camera,
  target: THREE.Vector3,
  distance: number,
  controls: OrbitControlsLike | null,
): void {
  scratchDirection.copy(camera.position).sub(target)
  if (scratchDirection.lengthSq() === 0) scratchDirection.copy(FALLBACK_ORBIT_DIRECTION)
  scratchDirection.normalize()
  camera.position.copy(target).addScaledVector(scratchDirection, distance)
  controls?.update()
}
