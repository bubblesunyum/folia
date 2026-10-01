// Panel metrics, single-sourced (fol-8z6): the TS numbers behind the sheet
// CSS in styles.css. Pure and three-free so the DOM sheet and the canvas rig
// share it without pulling the other graph in (D-047).
//
// Breakpoint contract: viewports `>= PANEL_NARROW_PX` take the right sheet;
// the CSS media query must match (`max-width: 899px` ↔ 900). The e2e pins:
// 1440w → viewOffset `320,0` (640-cap/2), 390x844 → `0,210` (420-cap/2).

import type { PedestalSlug } from './pedestals'

/** Below this width the sheet docks to the bottom instead of the right. */
export const PANEL_NARROW_PX = 900

/** The sheet's share of a wide viewport, capped for readable measure. */
export const PANEL_WIDE_FRACTION = 0.45
export const PANEL_WIDE_MAX_PX = 640

/** The bottom sheet's share of a narrow viewport, capped so world remains. */
export const PANEL_SHEET_FRACTION = 0.5
export const PANEL_SHEET_MAX_PX = 420

export type PanelVariant = 'side' | 'bottom'

/** Which sheet the viewport takes: right side at/above the breakpoint. */
export function panelVariant(viewportWidth: number): PanelVariant {
  return viewportWidth >= PANEL_NARROW_PX ? 'side' : 'bottom'
}

/** The view-offset target for a viewport with (or without) an open panel. */
export function viewOffsetTarget(
  viewportWidth: number,
  viewportHeight: number,
  panelSlug: PedestalSlug | null,
): { x: number; y: number } {
  if (panelSlug === null) return { x: 0, y: 0 }
  if (viewportWidth >= PANEL_NARROW_PX) {
    return { x: Math.min(viewportWidth * PANEL_WIDE_FRACTION, PANEL_WIDE_MAX_PX) / 2, y: 0 }
  }
  return { x: 0, y: Math.min(viewportHeight * PANEL_SHEET_FRACTION, PANEL_SHEET_MAX_PX) / 2 }
}
