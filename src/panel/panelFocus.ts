// Keyboard focus ownership for the 2D panel (fol-l7d.11, spec keyboard):
// the DOM panel owns focus trap and focus return; the R3F rigs only wire
// intent uniforms (FOCUS_LIFT_EVENT) and never touch focus. Pure core, thin
// rig: this module holds the handoff state and the trap decision, the
// PanelPresenter wires events and the place route consumes the handoff.

/** Selects every Tab-stop inside the panel sheet (links, buttons, tabbed customs). */
export const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

// One-shot handoff from a closing panel to the place route it returns to:
// the panel requests with its slug on unmount, the place route takes it on
// mount and lands focus on that case link. A slug→slug replace never
// unmounts, so swaps request nothing; a reopening panel clears a stale
// handoff before any route can consume it.
let pendingReturn: string | null = null

/** The closing panel hands its slug back for focus return. */
export function requestFocusReturn(slug: string): void {
  pendingReturn = slug
}

/** Takes the handoff, clearing it: null when no panel just closed. */
export function takeFocusReturn(): string | null {
  const slug = pendingReturn
  pendingReturn = null
  return slug
}

/** A reopening panel clears a stale handoff before any route consumes it. */
export function clearFocusReturn(): void {
  pendingReturn = null
}

/**
 * Which trap item to wrap Tab onto, by index, or null to let the browser
 * move focus naturally. Tab past the last wraps to the first; Shift+Tab on
 * the first — or on the trap container itself (`activeIndex` -1) — wraps to
 * the last. Everything else falls through untouched.
 */
export function trapWrapTarget(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count <= 0) return null
  if (shiftKey) {
    if (activeIndex <= 0) return count - 1
    return null
  }
  if (activeIndex === count - 1) return 0
  return null
}
