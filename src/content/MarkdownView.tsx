// biome-ignore-all lint/suspicious/noArrayIndexKey: bodies are static per page
// load and never reorder, so position is a stable key; content-derived keys
// dev-warn on identical siblings for no benefit.
import { Fragment } from 'react'
import { Link } from 'react-router'
import type { Block, Inline } from './markdown'

/** Renders one parsed markdown block list as real HTML (D-019). */
export function MarkdownView({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return block.depth === 2 ? (
            <h2 key={index}>
              <Inlines parts={block.text} />
            </h2>
          ) : (
            <h1 key={index}>
              <Inlines parts={block.text} />
            </h1>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                // Bodies are static per page load and never reorder, so
                // position is a stable key.
                <li key={itemIndex}>
                  <Inlines parts={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            <Inlines parts={block.text} />
          </p>
        )
      })}
    </>
  )
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        const text = part.bold === true ? <strong key={index}>{part.text}</strong> : part.text
        // Same-origin links stay client-side (Link), so content navigation
        // never tears down the persistent canvas; external links stay anchors.
        if (part.href === undefined) return <Fragment key={index}>{text}</Fragment>
        return part.href.startsWith('/') ? (
          <Link key={index} to={part.href} prefetch="intent">
            {text}
          </Link>
        ) : (
          <a key={index} href={part.href}>
            {text}
          </a>
        )
      })}
    </>
  )
}
