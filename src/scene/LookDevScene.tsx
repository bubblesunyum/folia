import { OrbitControls } from '@react-three/drei'
import { Suspense } from 'react'
import { renderConfig } from '../debug'
import { ZoomRig } from '../input/ZoomRig'
import { PanelCameraRig } from '../panel/PanelCameraRig'
import { PedestalNavigate } from '../panel/PedestalNavigate'
import { WispLight } from '../panel/WispLight'
import { StressDraws } from '../perf/StressDraws'
import { AmbientMotion } from './AmbientMotion'
import { Fragment } from './Fragment'
import { HoverHighlight } from './HoverHighlight'
import { LightPools } from './LightPools'
import { Lights } from './Lights'
import { MaterialLook } from './MaterialLook'
import { SkyEnvironment } from './SkyEnvironment'
import { WaterReflection } from './WaterReflection'

/** The look-dev scene: the Cortico fragment under the real env, lights, time of day and water. */
export function LookDevScene() {
  return (
    <>
      <OrbitControls makeDefault target={[0, 2, 0]} enableZoom={false} />
      <ZoomRig />
      <SkyEnvironment />
      <Lights />
      <WispLight />
      <MaterialLook />
      {renderConfig.sway && <AmbientMotion />}
      {renderConfig.reflection && <WaterReflection />}
      <Suspense fallback={null}>
        <Fragment />
        <LightPools />
      </Suspense>
      <HoverHighlight />
      <PedestalNavigate />
      <PanelCameraRig />
      {renderConfig.stress > 0 && <StressDraws count={renderConfig.stress} />}
    </>
  )
}
