import { useLook } from '../time/lookContext'

const DISTANCE = 40
const SHADOW_EXTENT = 16

/**
 * The sun and the moon, both always in the scene so the light count (and every
 * program) stays fixed as the time of day moves (D-038). The sun is first and
 * casts the only shadow, so it's `directionalLights[0]` in the foliage feature.
 */
export function Lights() {
  const { look, sun, moon } = useLook()
  const at = (d: readonly number[]) => d.map((v) => v * DISTANCE) as [number, number, number]
  return (
    <>
      <directionalLight
        castShadow
        position={at(sun.direction)}
        intensity={look.sun.intensity * sun.daylight}
        color={look.sun.color as [number, number, number]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={DISTANCE * 2}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
      />
      <directionalLight
        position={at(moon.direction)}
        intensity={look.moon.intensity}
        color={look.moon.color as [number, number, number]}
      />
    </>
  )
}
