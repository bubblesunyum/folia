import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { SWAY_STRENGTH, sway } from '../materials/features'
import { RIPPLE_CONSUMER_ID, rippleConsumer } from '../materials/water'
import { getCaseInView } from '../panel/caseInView'
import { setCanvasHook } from '../testHooks'
import { ambient, isAmbientReading } from '../time/ambient'

/** One ~30 Hz owner for foliage and pond motion, including reflection=off. */
export function AmbientMotion() {
  const invalidate = useThree((state) => state.invalidate)
  const canvas = useThree((state) => state.gl.domElement)

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    setCanvasHook(canvas, 'ambientTime', '0')
    setCanvasHook(canvas, 'ambientFrames', '0')
    let frameCount = 0
    ambient.register('sway', {
      update: (time) => {
        sway.uniforms.uSwayTime.value = time
        frameCount += 1
        setCanvasHook(canvas, 'ambientTime', String(time))
        setCanvasHook(canvas, 'ambientFrames', String(frameCount))
      },
      claim: () => {
        sway.uniforms.uSwayStrength.value = SWAY_STRENGTH
      },
      release: () => {
        sway.uniforms.uSwayStrength.value = 0
      },
    })
    ambient.register(RIPPLE_CONSUMER_ID, rippleConsumer())

    const readSignals = () => ({
      visible: document.visibilityState === 'visible',
      reading: isAmbientReading(),
      panelOpen: getCaseInView() !== null,
      reducedMotion: motionPreference.matches,
    })
    const tick = () => {
      // Ambient-only invalidation (fol-kes.17): this deliberately never
      // touches the shadow flags — `Lights` refreshes the map only when the
      // camera, sun, look or lift moved since the last frame, so these ticks
      // render with `needsUpdate` down and skip the shadow pass.
      if (ambient.tick(performance.now(), readSignals())) invalidate()
    }
    const onResume = () => ambient.rebase(performance.now())
    const interval = window.setInterval(tick, Math.ceil(ambient.intervalMs))
    document.addEventListener('visibilitychange', onResume)
    motionPreference.addEventListener('change', onResume)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onResume)
      motionPreference.removeEventListener('change', onResume)
      ambient.unregister(RIPPLE_CONSUMER_ID)
      ambient.unregister('sway')
      setCanvasHook(canvas, 'ambientTime', '0')
      setCanvasHook(canvas, 'ambientFrames', '0')
    }
  }, [canvas, invalidate])

  return null
}
