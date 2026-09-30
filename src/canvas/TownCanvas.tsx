import { lazy, Suspense } from 'react'
import { debug } from '../debug'
import { Effects } from '../renderer/Effects'
import { Viewport } from '../renderer/Viewport'
import { LookDevScene } from '../scene/LookDevScene'
import { TownBatches } from '../scene/TownBatches'
import { LookProvider } from '../time/LookProvider'

const PerfHud = lazy(() =>
  import('../perf/PerfHud').then((module) => ({ default: module.PerfHud })),
)

/**
 * Everything WebGL, behind the client-only lazy boundary in `App`. three,
 * R3F and the scene never enter the initial module graph (D-047).
 */
export function TownCanvas({ onSky }: { onSky: () => void }) {
  return (
    <Viewport onFirstFrame={onSky}>
      <LookProvider>
        <TownBatches>
          <LookDevScene />
        </TownBatches>
        <Effects />
      </LookProvider>
      {debug.hud && (
        <Suspense fallback={null}>
          <PerfHud />
        </Suspense>
      )}
    </Viewport>
  )
}
