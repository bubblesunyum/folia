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

function serverLayout(slug: PedestalSlug | null): PanelLayout {
  return {
    slug,
    variant: panelVariant(SERVER_VIEWPORT.width),
    viewTarget: viewOffsetTarget(SERVER_VIEWPORT.width, SERVER_VIEWPORT.height, slug),
  }
}

function clientLayout(slug: PedestalSlug | null): PanelLayout {
  return {
    slug,
    variant: panelVariant(window.innerWidth),
    viewTarget: viewOffsetTarget(window.innerWidth, window.innerHeight, slug),
  }
}

export function usePanelLayout(): PanelLayout {
  // The initial state must match the prerendered HTML on every viewport:
  // React 19 does not patch attributes that mismatch during hydration, so
  // reading window.innerWidth here would leave data-variant stuck at 'side'
  // after a direct load on a phone. Measure the real viewport in the mount
  // effect instead; that posts a normal state update React applies.
  const [layout, setLayout] = useState<PanelLayout>(() => serverLayout(getCaseInView()))
  useEffect(() => {
    const sync = (slug: PedestalSlug | null): void => setLayout(clientLayout(slug))
    const off = onCaseInView(sync)
    sync(getCaseInView())
    const onResize = (): void => setLayout(clientLayout(getCaseInView()))
    window.addEventListener('resize', onResize)
    return () => {
      off()
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return layout
}
