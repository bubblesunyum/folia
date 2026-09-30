import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { SWAY_STRENGTH, sway } from '../materials/features'
import { ambient, isAmbientReading } from '../time/ambient'

/**
 * Foliage sway (spike 5, D-041) on the ambient clock (D-056, fol-s6f):
 * registers its uniforms as a consumer and drives the shared scheduler,
 * which emits at ~30 Hz at rest and freezes while hidden or reading.
 * Mounted only with `?sway=on`, since driving frames opts out of the idle
 * rest (D-056); unmounting unregisters, handing the strength back so still
 * renders sit on the authored shape.
 */
/** The ambient signals in one place, so the interval driver and the
 * interaction fold-in can never disagree about what pauses the clock. */
function readAmbientSignals() {
  return {
    visible: document.visibilityState === 'visible',
    reading: isAmbientReading(),
  }
}

export function Sway() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    ambient.register('sway', {
      update: (time) => {
        sway.uniforms.uSwayTime.value = time
      },
      claim: () => {
        sway.uniforms.uSwayStrength.value = SWAY_STRENGTH
      },
      release: () => {
        sway.uniforms.uSwayStrength.value = 0
      },
    })
    const id = window.setInterval(() => {
      if (ambient.tick(performance.now(), readAmbientSignals())) invalidate()
    }, ambient.intervalMs)
    const onVisibility = () => ambient.rebase(performance.now())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      ambient.unregister('sway')
    }
  }, [invalidate])
  // Frames caused by anything else (orbiting, hover) fold into the same
  // clock, so sway stays smooth in motion without its own display-rate loop.
  useFrame(() => {
    if (ambient.tick(performance.now(), readAmbientSignals())) {
      invalidate()
    }
  })
  return null
}
