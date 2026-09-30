import { type ComponentType, type ReactNode, Suspense, useEffect, useState } from 'react'
import { CanvasBoundary } from './CanvasBoundary'

// How long the canvas takes to fade in over the shell once it paints.
// This must match the `.canvas-fade.is-ready` transition in styles.css:
// the shell unmounts CROSSFADE_MS + 150ms after the first frame, once the
// fade has fully covered it.
const CROSSFADE_MS = 700

/**
 * The persistent canvas host (D-003, D-047). The shell gradient stays mounted
 * underneath while the canvas chunk streams and through the first frame; the
 * canvas then crossfades in over it (CSS opacity transition) and the shell
 * unmounts only after the crossfade completes. Route content (children) stays
 * mounted throughout, so the HTML layer never cuts out.
 *
 * three and R3F stay on the far side of an effect-gated import: React invokes
 * a `lazy()` initializer during server rendering too, which would evaluate
 * the canvas chunk (and its window-touching modules) in node. An effect never
 * runs during prerender/SSR, so the chunk is only ever evaluated in the
 * browser. This module itself only ever imports shell code, so the prerender
 * graph stays react-only (D-047).
 */
export function CanvasHost({ children }: { children?: ReactNode }) {
  // The shell stays up through the chunk load AND the first-frame window
  // (context creation, shader compile), so first paint never flashes dark.
  const [sky, setSky] = useState(false)
  const [shellGone, setShellGone] = useState(false)
  const [Canvas, setCanvas] = useState<ComponentType<{ onSky: () => void }> | null>(null)
  useEffect(() => {
    if (!sky) return
    const id = window.setTimeout(() => setShellGone(true), CROSSFADE_MS + 150)
    return () => window.clearTimeout(id)
  }, [sky])
  // Client-only: loads the canvas chunk after hydration. On a chunk failure
  // the shell simply stays up.
  useEffect(() => {
    let live = true
    void import('../canvas/TownCanvas').then(
      (module) => {
        if (live) setCanvas(() => module.TownCanvas)
      },
      (error: unknown) => console.error('folia: canvas chunk failed', error),
    )
    return () => {
      live = false
    }
  }, [])
  return (
    <div className="canvas-host">
      {!shellGone && (
        <div className="shell-backdrop" aria-hidden="true" data-testid="shell-backdrop">
          <div className="sky-shell-gradient" />
        </div>
      )}
      <div className={sky ? 'canvas-fade is-ready' : 'canvas-fade'}>
        <CanvasBoundary>
          <Suspense fallback={null}>
            {Canvas === null ? null : <Canvas onSky={() => setSky(true)} />}
          </Suspense>
        </CanvasBoundary>
      </div>
      {children}
    </div>
  )
}
