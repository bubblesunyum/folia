import { lazy, Suspense } from 'react'
import { debug } from '../debug'
import { BenchStatusReadout } from '../time/BenchStatusReadout'

const LevaPanel = lazy(() => import('leva').then((module) => ({ default: module.Leva })))

/**
 * The look-dev bench's DOM: the leva panel plus the save-status readout.
 * Client-only: `debug.ts` reads `window` at import, so this module loads
 * through an effect in the root route and never enters the prerender graph
 * (D-047). Rendered after the canvas in paint order, so the bench takes
 * pointer events instead of the viewport.
 */
export function BenchHost() {
  if (!debug.panel) return null
  return (
    <Suspense fallback={null}>
      {/* The bench's own DOM hook (BENCH_ROOT_ATTRIBUTE in time/ambient):
          inline bench DOM lives under it. `display: contents` keeps it out
          of layout; leva's panel portals to a body-level #leva__root outside
          it, matched by selector fallback until tweakpane. */}
      <div data-lookdev-bench style={{ display: 'contents' }}>
        <LevaPanel hidden={false} />
        <BenchStatusReadout />
      </div>
    </Suspense>
  )
}
