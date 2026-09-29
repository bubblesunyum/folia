import { lazy, Suspense, useState } from 'react'
import { debug } from './debug'
import { CanvasBoundary } from './shell/CanvasBoundary'
import { SkyShell } from './shell/SkyShell'
import { BenchStatusReadout } from './time/BenchStatusReadout'

const LevaPanel = lazy(() => import('leva').then((module) => ({ default: module.Leva })))
const TownCanvas = lazy(() =>
  import('./canvas/TownCanvas').then((module) => ({ default: module.TownCanvas })),
)

export function App() {
  // The shell stays up through the chunk load AND the first-frame window
  // (context creation, shader compile), so first paint never flashes dark.
  const [sky, setSky] = useState(false)
  return (
    <>
      {!sky && <SkyShell />}
      <CanvasBoundary>
        <Suspense fallback={null}>
          <TownCanvas onSky={() => setSky(true)} />
        </Suspense>
      </CanvasBoundary>
      {/* After the canvas: later positioned siblings paint above, so the
          bench takes pointer events instead of the viewport. */}
      {debug.panel && (
        <Suspense fallback={null}>
          <LevaPanel hidden={false} />
          <BenchStatusReadout />
        </Suspense>
      )}
    </>
  )
}
