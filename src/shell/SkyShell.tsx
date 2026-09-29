/**
 * The sky-first shell: what `/` shows before the canvas paints its first
 * frame, and what crawlers and no-JS clients get. three and R3F stay on the
 * far side of the lazy boundary in `App`, so this module must never import
 * them (D-047). index.html hand-mirrors this markup until RR v8 prerender
 * generates it (D-059).
 */
export function SkyShell() {
  return (
    <div className="sky-shell">
      <div className="sky-shell-gradient" aria-hidden="true" />
      <main className="sky-shell-content">
        <h1>portfolio town</h1>
        <p>a solarpunk town portfolio, starting with cortico</p>
      </main>
    </div>
  )
}
