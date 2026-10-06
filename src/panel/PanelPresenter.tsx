// The PanelPresenter seam (fol-l1r.5, D-010): everything between routing /
// content and the panel chrome lives behind this component, so Poppy and the
// particle materialize slot in later without touching routing or content.
// Today the seam holds: the open-case registration (canvas rigs ease, offset
// and perch off it), the side sheet with the neon breadcrumb, the one-word
// Close, and the close paths — Close, Escape (via the intent layer's
// PANEL_CLOSE_EVENT, never a second global handler), the rise detent and the
// empty-world miss. The case body itself still renders through the kind
// registry, untouched.

import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { CaseContent } from '../content/Panel'
import { rendererFor } from '../content/registry'
import { PANEL_CLOSE_EVENT, setPanelOpen } from '../input/intent'
import { RISE_EVENT } from '../input/sources'
import { withQaSearch } from '../time/timeParam'
import { getCaseInView, setCaseInView } from './caseInView'
import {
  clearFocusReturn,
  FOCUSABLE_SELECTOR,
  requestFocusReturn,
  trapWrapTarget,
} from './panelFocus'
import { type PedestalSlug, slotForSlug } from './pedestals'
import { usePanelLayout } from './usePanelLayout'
import { usePedestalRouteSync } from './usePedestalRouteSync'

export interface PresenterContent extends CaseContent {
  kind: string
}

export function PanelPresenter({ content }: { content: PresenterContent }) {
  const navigate = useNavigate()
  const { search } = useLocation()
  const { slug, projectSlug } = content
  usePedestalRouteSync()
  const { variant } = usePanelLayout()
  const panelRef = useRef<HTMLElement | null>(null)
  // The handoff slug can go stale across a case→case replace (same instance,
  // new slug, no unmount), so the cleanup reads it through a ref.
  const slugRef = useRef(slug)
  slugRef.current = slug

  const close = useCallback(() => {
    // Open pushes /cortico → /cortico/<slug> (case-for-case swaps replace),
    // so popping returns to the project page without stacking a duplicate
    // /cortico entry — otherwise Back would reopen the closed panel
    // (fol-e6h). A directly loaded case has no previous entry (router idx
    // 0), so replace to the project page instead. Either way the QA search
    // rides along (fol-76l): popping restores the pushed URL as-is, and the
    // replace carries it explicitly.
    const idx = (window.history.state as { idx?: unknown } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(withQaSearch(`/${projectSlug}`, search), { replace: true })
  }, [navigate, projectSlug, search])

  // Open-case registration: the canvas rigs (focus ease, view offset, wisp)
  // and ZoomRig's Escape priority read this. A content-only case (MDX added
  // with no pedestal yet) fails closed: the chrome and body still render,
  // but nothing registers a case in view, so no camera ease aims at nowhere
  // and no wisp anchors to nothing.
  useEffect(() => {
    setPanelOpen(true)
    const known = slotForSlug(slug) === null ? null : (slug as PedestalSlug)
    if (known !== null) setCaseInView(known)
    return () => {
      // A slug→slug replace runs this cleanup just before the next setup
      // re-asserts: the transient closed state never escapes the commit, and
      // only the owner clears the case so a stale unmount can't blank the
      // newly opened one.
      if (known !== null && getCaseInView() === known) setCaseInView(null)
      setPanelOpen(false)
    }
  }, [slug])

  // Escape (intent layer), the rise detent and empty-world misses all land
  // here; the panel owns the close animation downstream.
  useEffect(() => {
    const onDismiss = (): void => close()
    window.addEventListener(PANEL_CLOSE_EVENT, onDismiss)
    window.addEventListener(RISE_EVENT, onDismiss)
    return () => {
      window.removeEventListener(PANEL_CLOSE_EVENT, onDismiss)
      window.removeEventListener(RISE_EVENT, onDismiss)
    }
  }, [close])

  // Focus ownership (fol-l7d.11, spec keyboard): the panel takes focus on
  // open so keyboard and screen-reader users land in it, and hands its slug
  // back on unmount so the place route returns focus to the case link.
  // Mount-only: a case→case replace re-renders without unmounting, so focus
  // stays where the user put it and no handoff is requested mid-panel.
  useEffect(() => {
    clearFocusReturn()
    panelRef.current?.focus()
    return () => {
      requestFocusReturn(slugRef.current)
    }
    // Mount-only by design: a case→case replace re-renders without
    // unmounting, so deps stay empty and focus stays where the user put it.
  }, [])

  const Panel = rendererFor(content.kind)
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="case-panel"
      data-testid="case-panel"
      data-case={slug}
      data-variant={variant}
      aria-label="case panel"
      onKeyDown={(event) => {
        // The Tab trap (fol-l7d.11): wrap past either end, otherwise let the
        // browser move focus naturally between the sheet's stops.
        if (event.key !== 'Tab' || event.defaultPrevented) return
        const root = panelRef.current
        if (root === null) return
        const items = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        const target = trapWrapTarget(
          items.length,
          items.indexOf(document.activeElement as Element),
          event.shiftKey,
        )
        if (target === null) return
        event.preventDefault()
        ;(items[target] as HTMLElement | undefined)?.focus()
      }}
    >
      <div className="case-panel-top">
        <p className="case-breadcrumb" data-testid="panel-breadcrumb">
          {projectSlug} › {slug}
        </p>
        <span className="wisp-perch" aria-hidden="true" />
      </div>
      <Panel content={content} />
      <button type="button" data-testid="panel-close" onClick={close}>
        Close
      </button>
    </aside>
  )
}
