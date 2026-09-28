import { Leva } from 'leva'
import { debug } from './debug'
import { PerfHud } from './perf/PerfHud'
import { Effects } from './renderer/Effects'
import { Viewport } from './renderer/Viewport'
import { TestScene } from './scene/TestScene'

export function App() {
  return (
    <>
      <Leva hidden={!debug.panel} collapsed />
      <Viewport>
        <TestScene />
        <Effects />
        {debug.hud && <PerfHud />}
      </Viewport>
    </>
  )
}
