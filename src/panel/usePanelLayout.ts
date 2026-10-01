// The panel layout hook (fol-8z6): subscribes to the open case, tracks the
// viewport through the resize listener, and derives the sheet variant and
// view-offset target from the single-sourced metrics. The DOM sheet and the
// canvas rig consume the same hook output, so TS and CSS cannot drift.
// Prerender-safe: without a window it falls back to a wide viewport.

import { useEffect, useState } from 'react'
import { getCaseInView, onCaseInView } from './caseInView'
import { type PanelVariant, panelVariant, viewOffsetTarget } from './metrics'
import type { PedestalSlug } from './pedestals'

export interface PanelLayout {
  slug: PedestalSlug | null
  variant: PanelVariant
  viewTarget: { x: number; y: number }
}

/** Wide-viewport fallback for prerender, where there is no window. */
const SERVER_VIEWPORT = { width: 1440, height: 900 }

function currentLayout(slug: PedestalSlug | null): PanelLayout {
  const width = typeof window === 'undefined' ? SERVER_VIEWPORT.width : window.innerWidth
  const height = typeof window === 'undefined' ? SERVER_VIEWPORT.height : window.innerHeight
  return { slug, variant: panelVariant(width), viewTarget: viewOffsetTarget(width, height, slug) }
}

export function usePanelLayout(): PanelLayout {
  const [layout, setLayout] = useState<PanelLayout>(() => currentLayout(getCaseInView()))
  useEffect(() => {
    const sync = (slug: PedestalSlug | null): void => setLayout(currentLayout(slug))
    const off = onCaseInView(sync)
    sync(getCaseInView())
    const onResize = (): void => setLayout(currentLayout(getCaseInView()))
    window.addEventListener('resize', onResize)
    return () => {
      off()
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return layout
}
