import { Suspense } from 'react'
import { Link } from 'react-router'
import { caseBody } from './bodies'
import { mdxComponents } from './mdx-components'

export interface CaseContent {
  projectSlug: string
  projectTitle: string
  slug: string
  title: string
  summary: string
}

/**
 * The minimal "panel" kind renderer: a readable article over the canvas with
 * real links. The body is the same build-time compiled MDX component the
 * prerender emits, so panel and static HTML can't drift. Wave 2 (fol-l1r.5)
 * replaces this with the full side-sheet panel UI; the kind contract it plugs
 * into stays.
 */
export function CasePanel({ content }: { content: CaseContent }) {
  // Warmed by the case route loader, so this resolves synchronously on
  // prerender and navigation; the boundary covers client hydration, whose
  // loaders never re-run (fol-kes.9).
  const Body = caseBody(content.projectSlug, content.slug)
  return (
    <article className="route-content">
      <h1>{content.title}</h1>
      <p>{content.summary}</p>
      <Suspense fallback={null}>
        <Body components={mdxComponents} />
      </Suspense>
      <p>
        <Link to={`/${content.projectSlug}`} prefetch="intent">
          {content.projectTitle}
        </Link>
      </p>
    </article>
  )
}
