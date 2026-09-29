import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { SWAY_STRENGTH, sway } from '../materials/features'

/**
 * The sway clock (spike 5, D-041): claims the sway strength, advances the
 * time and keeps frames coming. Mounted only with `?sway=on`, since a standing
 * invalidate opts out of the idle rest (D-056); unmounting hands the strength
 * back so still renders sit on the authored shape.
 */
export function Sway() {
  useEffect(() => {
    sway.uniforms.uSwayStrength.value = SWAY_STRENGTH
    return () => {
      sway.uniforms.uSwayStrength.value = 0
    }
  }, [])
  useFrame(({ clock, invalidate }) => {
    sway.uniforms.uSwayTime.value = clock.elapsedTime
    invalidate()
  })
  return null
}
