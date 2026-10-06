import type { ComponentType, ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { withQaSearch } from '../time/timeParam'

// Overrides injected into every compiled MDX body via the `components` prop
// (no MDX provider — the browser graph stays react-only, D-047).
// Same-origin links stay client-side (Link), so content navigation never
// tears down the persistent canvas; external links stay anchors.
export interface MdxLinkProps {
  href?: string
  children?: ReactNode
}

function MdxLink({ href, children }: MdxLinkProps) {
  // The QA search (?time=, render switches) rides along so MDX body links
  // never drop a QA session back to defaults (fol-76l).
  const { search } = useLocation()
  if (href === undefined) return <>{children}</>
  return href.startsWith('/') ? (
    <Link to={withQaSearch(href, search)} prefetch="intent">
      {children}
    </Link>
  ) : (
    <a href={href}>{children}</a>
  )
}

export type MdxComponents = Record<string, ComponentType<MdxLinkProps>>

export const mdxComponents: MdxComponents = { a: MdxLink }
