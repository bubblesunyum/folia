import { Leva } from 'leva'
import { debug } from './debug'
import { PerfHud } from './perf/PerfHud'
import { Effects } from './renderer/Effects'
import { Viewport } from './renderer/Viewport'
import { LookDevScene } from './scene/LookDevScene'
import { LookProvider } from './time/LookProvider'

export function App() {
  return (
    <>
      <Leva hidden={!debug.panel} collapsed />
      <Viewport>
        <LookProvider>
          <LookDevScene />
          <Effects />
        </LookProvider>
        {debug.hud && <PerfHud />}
      </Viewport>
    </>
  )
}
