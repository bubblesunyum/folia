/**
 * Canvas dataset hooks plus the named window keys (fol-di2): the canvas
 * `dataset` keys and the rise-counter/projector window keys the e2e specs
 * read live here, so a rename breaks one import, not five files. Behavior is
 * unchanged — the dataset keys still serialize to the same `data-*`
 * attributes (`canvas[data-sun]`, `dataset.zoom`, …) the specs already
 * select on.
 *
 * Not every window key lives here: per-spec instrumentation patched in by
 * the spec itself — like the `foliaDrawCalls` demand-loop counter in the
 * input/scene specs — stays in the spec, next to the patch that owns it.
 *
 * Dependency-free on purpose: producers import the writers, and Playwright
 * specs import the keys/selectors (passed into `page.evaluate` as args,
 * since the browser closure can't see Node imports).
 */

/** Canvas dataset hooks, by `dataset` key. */
export type CanvasHookName =
  | 'zoom'
  | 'sun'
  | 'rises'
  | 'rendered'
  | 'assets'
  | 'drawnAssets'
  | 'hover'
  | 'hoverSettled'
  | 'lifted'
  | 'panel'
  | 'viewOffset'
  | 'focus'

/** Anything with a `dataset` we write hooks onto (a real canvas, or a fake). */
export interface DatasetHost {
  dataset: Record<string, string | undefined>
}

/** Writes one canvas hook (`dataset.zoom = …`, `data-hover-settled`, …). */
export function setCanvasHook(host: DatasetHost, name: CanvasHookName, value: string): void {
  host.dataset[name] = value
}

/** Reads one canvas hook back. */
export function readCanvasHook(host: DatasetHost, name: CanvasHookName): string | undefined {
  return host.dataset[name]
}

/** `hoverSettled` → `hover-settled`: dataset keys serialize to kebab-case. */
function toAttributeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** The `data-*` attribute a hook serializes to (`sun` → `data-sun`). */
export function canvasHookAttribute(name: CanvasHookName): string {
  return `data-${toAttributeCase(name)}`
}

/** A canvas locator for specs (`sun` → `canvas[data-sun]`, with value when given). */
export function canvasHookSelector(name: CanvasHookName, value?: string): string {
  const attribute = canvasHookAttribute(name)
  return value === undefined ? `canvas[${attribute}]` : `canvas[${attribute}="${value}"]`
}

/** `window` shape for the rise counter (fol-etn's detent signal). */
export interface RiseCountHost {
  foliaRiseCount?: number
}

/** The window key the counter lives under. */
export const RISE_COUNT_KEY = 'foliaRiseCount'

/** Reads the rise counter (0 when never risen). */
export function readRiseCount(host: RiseCountHost): number {
  return host.foliaRiseCount ?? 0
}

/** Bumps the rise counter, returning the new count. */
export function incrementRiseCount(host: RiseCountHost): number {
  const next = readRiseCount(host) + 1
  host.foliaRiseCount = next
  return next
}

/**
 * Records one rise on both hooks: the window counter and the canvas readout,
 * which must never disagree about how many rises happened.
 */
export function recordRise(canvas: DatasetHost, host: RiseCountHost): number {
  const next = incrementRiseCount(host)
  setCanvasHook(canvas, 'rises', String(next))
  return next
}

/** A world position in metres (three.js x, y-up, z), for projector calls. */
export type WorldPoint = readonly [number, number, number]

/** Test-only projector: world position → canvas CSS pixels (fol-xo6). */
export type FoliaProjector = (world: WorldPoint) => {
  x: number
  y: number
}

/** `window` shape for the hover projector. */
export interface ProjectorHost {
  foliaProject?: FoliaProjector
}

/** The window key the projector mounts under. */
export const PROJECTOR_KEY = 'foliaProject'

declare global {
  interface Window {
    /** Test-only projector: world position → canvas CSS pixels (fol-xo6). */
    foliaProject?: FoliaProjector
  }
}

/** Mounts the hover projector for specs. */
export function setProjector(host: ProjectorHost, project: FoliaProjector): void {
  host.foliaProject = project
}

/** Reads the mounted projector, if any. */
export function readProjector(host: ProjectorHost): FoliaProjector | undefined {
  return host.foliaProject
}

/** Unmounts the hover projector, leaving no hook behind. */
export function clearProjector(host: ProjectorHost): void {
  delete host.foliaProject
}

/** Assets registered and drawn in this canvas, for tests that need both. */
const drawnAssets = new Set<string>()

/**
 * Marks an asset drawn, returning the sorted CSV the `drawnAssets` hook
 * carries (every registered asset, not just the first to parse).
 */
export function markAssetDrawn(asset: string): string {
  drawnAssets.add(asset)
  return [...drawnAssets].sort().join(',')
}

/** Forgets an asset (unmount), so a remount re-reports from scratch. */
export function unmarkAssetDrawn(asset: string): void {
  drawnAssets.delete(asset)
}

/** Test-only reset for the drawn-asset registry. */
export function resetDrawnAssets(): void {
  drawnAssets.clear()
}
