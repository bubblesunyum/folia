import { OrbitControls } from '@react-three/drei'
import { Suspense } from 'react'
import { Fragment } from './Fragment'
import { Lights } from './Lights'
import { MaterialLook } from './MaterialLook'
import { SkyEnvironment } from './SkyEnvironment'

/** Spike 1+2's scene: the Cortico fragment under the real env, lights and time of day. */
export function LookDevScene() {
  return (
    <>
      <OrbitControls makeDefault target={[0, 2, 0]} />
      <SkyEnvironment />
      <Lights />
      <MaterialLook />
      <Suspense fallback={null}>
        <Fragment />
      </Suspense>
    </>
  )
}
