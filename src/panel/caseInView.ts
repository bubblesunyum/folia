// Which case the panel (and the canvas rigs) hold open, if any (fol-l1r.5).

import { createSubscribeStore } from '../store/subscribe'
import type { PedestalSlug } from './pedestals'

export type CaseInViewListener = (slug: PedestalSlug | null) => void

const store = createSubscribeStore<PedestalSlug | null>(null)

/** The open case slug, or null when no panel is up. */
export function getCaseInView(): PedestalSlug | null {
  return store.get()
}

/** Called by the PanelPresenter on open / swap / close; fans out to rigs. */
export function setCaseInView(slug: PedestalSlug | null): void {
  store.set(slug)
}

export function onCaseInView(listener: CaseInViewListener): () => void {
  return store.on(listener)
}
