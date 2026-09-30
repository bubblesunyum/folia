// Which case the panel (and the canvas rigs) hold open, if any (fol-l1r.5).
// A tiny subscribe store in the benchStatus idiom: module state, `onX`
// returns the unsubscribe. DOM-free and three-free, so route components,
// canvas rigs and Vitest share it without pulling the other graph in.

import type { PedestalSlug } from './pedestals'

export type CaseInViewListener = (slug: PedestalSlug | null) => void

let caseInView: PedestalSlug | null = null
const listeners = new Set<CaseInViewListener>()

/** The open case slug, or null when no panel is up. */
export function getCaseInView(): PedestalSlug | null {
  return caseInView
}

/** Called by the PanelPresenter on open / swap / close; fans out to rigs. */
export function setCaseInView(slug: PedestalSlug | null): void {
  if (caseInView === slug) return
  caseInView = slug
  for (const listener of [...listeners]) listener(caseInView)
}

export function onCaseInView(listener: CaseInViewListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
