/**
 * The sky-first shell: what a route shows before the canvas paints its first
 * frame, and what crawlers and no-JS clients get alongside the route content.
 * three and R3F stay on the far side of the lazy boundary in `CanvasHost`,
 * so this module must never import them (D-047).
 *
 * The gradient matches the canvas first frame: golden-hour sky above, the
 * dark-green ground hemisphere below (D-040) — never the light cream, so the
 * handoff crossfades instead of cutting from light to dark.
 */
import { ShellOcean } from './ShellOcean'

export function SkyShell() {
  return (
    <div className="sky-shell">
      <div className="sky-shell-gradient" aria-hidden="true" />
      {/* Cream-ocean first paint (D-018): opaque cream below the sky, the
          static stand-in for the WebGL ocean until the canvas takes over. */}
      <ShellOcean />
      <main className="sky-shell-content">
        <h1>portfolio town</h1>
        <p>a solarpunk town portfolio, starting with cortico</p>
      </main>
    </div>
  )
}
