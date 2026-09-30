// Canvas → DOM pedestal routing events (fol-l1r.5). The R3F canvas is its
// own React root, so router context never crosses into it: the canvas rig
// dispatches these window events and the DOM `usePedestalRouteSync` hook
// navigates. DOM-free and three-free, so both sides share it (D-047).

import type { PedestalSlug } from './pedestals'

/** The canvas asks the DOM to open a case after a pedestal click/second tap. */
export const CASE_OPEN_EVENT = 'folia:case-open'

export interface CaseOpenDetail {
  slug: PedestalSlug
}

export function requestCaseOpen(slug: PedestalSlug): void {
  window.dispatchEvent(new CustomEvent<CaseOpenDetail>(CASE_OPEN_EVENT, { detail: { slug } }))
}
