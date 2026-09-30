/**
 * One keyboard-intent layer for Escape (fol-l1r.10, D-006/D-048).
 *
 * ZoomRig's global Escape (rise one level) would otherwise fight the 2D
 * panel's Close/Escape (spec: Escape, the zoom-out detent, the wisp and
 * empty clicks all close the panel). Every Escape routes through
 * {@link resolveEscape}, which is pure so Vitest pins the matrix without a
 * browser; the rig only wires events, and the future panel (wave 2)
 * registers through the tiny store below instead of adding a second global
 * handler.
 *
 * Priority, first match wins:
 *
 * 1. focused-input — typing never hijacks: an Escape with focus in an
 *    input/textarea/select/contenteditable resolves to `noop`, and the rig
 *    returns without even `preventDefault`ing.
 * 2. close panel — when a panel is open, Escape closes it (the panel
 *    listens for {@link PANEL_CLOSE_EVENT}); it never also rises.
 * 3. rise level — otherwise Escape signals the one-level rise, unless the
 *    camera is already at the top (`canRise` false), which is a `noop`.
 *
 * Only Escape routes here: Enter/Space fall through untouched (see
 * {@link isDismissKey}), so focused links keep working and focus keeps
 * driving the same lift/glow as hover via {@link FOCUS_LIFT_EVENT}.
 *
 * Reduced motion is a pass-through flag: the snapshot carries it, the
 * resolution echoes it, and the close/rise events forward it. This layer
 * never animates, so it never reads the flag itself — the flights and the
 * panel animation honor it downstream.
 */

/** What an Escape press means once panel state and focus are considered. */
export type EscapeAction = 'noop' | 'close-panel' | 'rise-level'

export interface EscapeSnapshot {
  /** A 2D panel is open (registered through the store below). */
  panelOpen: boolean
  /** Focus sits in an input, textarea, select or contenteditable. */
  focusInEditable: boolean
  /** There is a level above to rise to; false at the town overview. */
  canRise: boolean
  /** Pass-through from `prefers-reduced-motion`; echoed, never consumed. */
  reducedMotion: boolean
}

export interface ResolvedEscape {
  action: EscapeAction
  /** Echo of the snapshot flag, for the close/rise event detail. */
  reducedMotion: boolean
}

/**
 * The single Escape resolver. Priority: focused-input (noop) > close panel
 * > rise level > noop.
 */
export function resolveEscape(snapshot: EscapeSnapshot): ResolvedEscape {
  if (snapshot.focusInEditable) return { action: 'noop', reducedMotion: snapshot.reducedMotion }
  if (snapshot.panelOpen) return { action: 'close-panel', reducedMotion: snapshot.reducedMotion }
  if (snapshot.canRise) return { action: 'rise-level', reducedMotion: snapshot.reducedMotion }
  return { action: 'noop', reducedMotion: snapshot.reducedMotion }
}

/**
 * Only Escape routes through this layer. Enter/Space (and every other key)
 * return false so focused links, buttons and typing are never intercepted.
 */
export function isDismissKey(key: string): boolean {
  return key === 'Escape'
}

// Panel registration (wave 2 seam). Tiny subscribe store in the benchStatus
// idiom: module-level state, `onX` returns the unsubscribe. No-op default —
// no panel exists yet, so the layer resolves to rise until one registers.

export type PanelListener = (open: boolean) => void

let panelOpen = false
const panelListeners = new Set<PanelListener>()

/** Whether a 2D panel is currently open. False until wave 2 registers one. */
export function isPanelOpen(): boolean {
  return panelOpen
}

/** Called by the future panel on open/close; fans out to subscribers. */
export function setPanelOpen(open: boolean): void {
  if (panelOpen === open) return
  panelOpen = open
  for (const listener of [...panelListeners]) listener(panelOpen)
}

export function onPanelOpen(listener: PanelListener): () => void {
  panelListeners.add(listener)
  return () => {
    panelListeners.delete(listener)
  }
}

// Window events between the rig and the future panel/picking. They live in
// this pure module (not in the rig component) so DOM-only code never pulls
// three or R3F into its module graph (D-047, same as sources.ts).

/** The rig asks the open panel to close; the panel owns the animation. */
export const PANEL_CLOSE_EVENT = 'folia:panel-close'

/**
 * Keyboard focus asks for the same 3D lift/glow as hover (spec keyboard
 * section). Picking consumes this later; this layer only names the event.
 */
export const FOCUS_LIFT_EVENT = 'folia:focus-lift'

export interface PanelCloseDetail {
  reducedMotion: boolean
}

export interface FocusLiftDetail {
  /** The pedestal/link id that received focus. */
  targetId: string
}

export function panelCloseDetail(reducedMotion: boolean): PanelCloseDetail {
  return { reducedMotion }
}

export function requestPanelClose(reducedMotion: boolean): void {
  window.dispatchEvent(
    new CustomEvent<PanelCloseDetail>(PANEL_CLOSE_EVENT, {
      detail: panelCloseDetail(reducedMotion),
    }),
  )
}

export function signalFocusLift(targetId: string): void {
  window.dispatchEvent(new CustomEvent<FocusLiftDetail>(FOCUS_LIFT_EVENT, { detail: { targetId } }))
}

/**
 * Pass-through reader for the reduced-motion flag. Safe outside the browser
 * (SSR, Vitest): no `window` or no `matchMedia` reads as false.
 */
export function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
