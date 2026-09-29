import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { DirectionalLight } from 'three'
import { renderConfig } from '../debug'
import { SHADOW_FITS } from '../perf/renderConfig'
import { useLook } from '../time/lookContext'
import { quantizeExtent, SHADOW_MAP_SIZE, snapShadowToTexels } from './shadowFit'

const DISTANCE = 40

/**
 * The sun and the moon, both always in the scene so the light count (and every
 * program) stays fixed as the time of day moves (D-038). The sun is first and
 * casts the only shadow, so it's `directionalLights[0]` in the foliage feature.
 *
 * Spike 5 (D-041): the shadow frustum is a quantized, texel-snapped fit —
 * `?fit=vantage` for the tight one, town by default — at 2048 PCF, re-rendered
 * every frame on the live policy. `?shadows=static` freezes the map instead,
 * the D-041 fallback: free while idle, but sway and lift detach from it.
 */
export function Lights() {
  const { look, sun, moon } = useLook()
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const sunRef = useRef<DirectionalLight>(null)
  const extent = quantizeExtent(SHADOW_FITS[renderConfig.shadowFit])
  const at = (d: readonly number[]) => d.map((v) => v * DISTANCE) as [number, number, number]

  // The target's matrix only updates inside the scene graph.
  useEffect(() => {
    const light = sunRef.current
    if (!light) return
    scene.add(light.target)
    return () => {
      scene.remove(light.target)
    }
  }, [scene])

  // R3F sets the ortho bounds from props but doesn't re-derive the projection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fit is fixed per page load
  useEffect(() => {
    const light = sunRef.current
    if (!light) return
    light.shadow.camera.updateProjectionMatrix()
  }, [])

  // The shadow policy (D-041). Static freezes the map after this frame and
  // re-freezes whenever the time of day moves the sun.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `look` is the re-freeze trigger
  useEffect(() => {
    gl.shadowMap.autoUpdate = renderConfig.shadowPolicy === 'live'
    if (renderConfig.shadowPolicy === 'static') {
      gl.shadowMap.needsUpdate = true
      invalidate()
    }
  }, [gl, invalidate, look])

  // Texel-snapped every rendered frame, so a moving sun or a tracking frustum
  // never shimmers; static otherwise, by construction.
  useFrame(() => {
    const light = sunRef.current
    if (!light) return
    snapShadowToTexels(light, extent)
  })

  return (
    <>
      <directionalLight
        ref={sunRef}
        castShadow
        position={at(sun.direction)}
        intensity={look.sun.intensity * sun.daylight}
        color={look.sun.color as [number, number, number]}
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={DISTANCE * 2}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
      />
      <directionalLight
        position={at(moon.direction)}
        intensity={look.moon.intensity}
        color={look.moon.color as [number, number, number]}
      />
    </>
  )
}
