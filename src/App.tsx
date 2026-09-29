import { lazy, Suspense } from 'react'
import { debug } from './debug'
import { Effects } from './renderer/Effects'
import { Viewport } from './renderer/Viewport'
import { LookDevScene } from './scene/LookDevScene'
import { LookProvider } from './time/LookProvider'

const LevaPanel = lazy(() => import('leva').then((module) => ({ default: module.Leva })))
const PerfHud = lazy(() => import('./perf/PerfHud').then((module) => ({ default: module.PerfHud })))

export function App() {
  return (
    <>
      {debug.panel && (
        <Suspense fallback={null}>
          <LevaPanel hidden={false} collapsed />
        </Suspense>
      )}
      <Viewport>
        <LookProvider>
          <LookDevScene />
          <Effects />
        </LookProvider>
        {debug.hud && (
          <Suspense fallback={null}>
            <PerfHud />
          </Suspense>
        )}
      </Viewport>
    </>
  )
}
