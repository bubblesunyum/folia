import { Link } from 'react-router'
import { MarkdownView } from './MarkdownView'
import type { Block } from './markdown'

export interface CaseContent {
  projectSlug: string
  projectTitle: string
  slug: string
  title: string
  summary: string
  blocks: Block[]
}

/**
 * The minimal "panel" kind renderer: a readable article over the canvas with
 * real links. Wave 2 (fol-l1r.5) replaces this with the full side-sheet
 * panel UI; the kind contract it plugs into stays.
 */
export function CasePanel({ content }: { content: CaseContent }) {
  return (
    <article className="route-content">
      <h1>{content.title}</h1>
      <p>{content.summary}</p>
      <MarkdownView blocks={content.blocks} />
      <p>
        <Link to={`/${content.projectSlug}`} prefetch="intent">
          {content.projectTitle}
        </Link>
      </p>
    </article>
  )
}
