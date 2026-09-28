import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useMemo } from 'react'
import { Color } from 'three'
import { palette } from '../palette'
import { useContextRestores } from '../renderer/contextRestores'
import { sunAt } from '../time/sun'
import { useTimeOfDay } from '../time/useTimeOfDay'

const SUN_DISTANCE = 30
const SHADOW_EXTENT = 8

/**
 * A throwaway scene for the scaffold: cream, gold and mint on forest ground, lit
 * by a sun and a small env scene, so tone mapping, shadows and the time
 * scrubber can be seen working. Spike 1's Cortico fragment replaces it.
 */
// Stand-in for the D-040 env scene: warm sun glow over dark-green ground, no
// hemisphere light. Built once at module scope because drei re-renders a
// frames={1} environment whenever its children change identity, which would
// redraw all six cube faces on every scrub of the time panel.
const envScene = (
  <>
    <color attach="background" args={[palette.skyDusk]} />
    <Lightformer
      form="circle"
      intensity={6}
      color={palette.tangerine}
      position={[0, 4, -9]}
      scale={4}
    />
    <Lightformer
      form="rect"
      intensity={1}
      color={palette.forest}
      position={[0, -5, 0]}
      rotation-x={-Math.PI / 2}
      scale={40}
    />
  </>
)

export function TestScene() {
  const hours = useTimeOfDay()
  const sun = useMemo(() => sunAt(hours), [hours])
  const sky = useMemo(
    () => new Color(palette.skyNight).lerp(new Color(palette.skyDusk), sun.daylight),
    [sun.daylight],
  )
  const [x, y, z] = sun.direction
  const restores = useContextRestores()

  return (
    <>
      <color attach="background" args={[sky]} />
      <OrbitControls makeDefault target={[0, 1, 0]} />

      {/* Keyed on restores: the one-shot env render is lost with the context. */}
      <Environment
        key={restores}
        resolution={256}
        frames={1}
        environmentIntensity={0.06 + 0.94 * sun.daylight}
      >
        {envScene}
      </Environment>

      <directionalLight
        castShadow
        position={[x * SUN_DISTANCE, y * SUN_DISTANCE, z * SUN_DISTANCE]}
        intensity={3 * sun.daylight}
        color={palette.cream}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
      />

      <mesh receiveShadow rotation-x={-Math.PI / 2}>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color={palette.forest} roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 1.8, 0]}>
        <capsuleGeometry args={[1.2, 1.2, 8, 32]} />
        <meshStandardMaterial color={palette.cream} roughness={0.35} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.6, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[2.4, 0.18, 24, 96]} />
        <meshStandardMaterial color={palette.gold} metalness={1} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[3.4, 0.05, 12, 128]} />
        <meshStandardMaterial
          color={palette.forest}
          emissive={palette.mint}
          emissiveIntensity={1 + 3 * (1 - sun.daylight)}
        />
      </mesh>
    </>
  )
}
