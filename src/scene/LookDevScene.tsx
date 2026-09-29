import { OrbitControls } from '@react-three/drei'
import { Suspense } from 'react'
import { renderConfig } from '../debug'
import { StressDraws } from '../perf/StressDraws'
import { Fragment } from './Fragment'
import { Lights } from './Lights'
import { MaterialLook } from './MaterialLook'
import { SkyEnvironment } from './SkyEnvironment'
import { Sway } from './Sway'
import { WaterReflection } from './WaterReflection'

/** The look-dev scene: the Cortico fragment under the real env, lights, time of day and water. */
export function LookDevScene() {
  return (
    <>
      <OrbitControls makeDefault target={[0, 2, 0]} />
      <SkyEnvironment />
      <Lights />
      <MaterialLook />
      {renderConfig.sway && <Sway />}
      {renderConfig.reflection && <WaterReflection />}
      <Suspense fallback={null}>
        <Fragment />
      </Suspense>
      {renderConfig.stress > 0 && <StressDraws count={renderConfig.stress} />}
    </>
  )
}
