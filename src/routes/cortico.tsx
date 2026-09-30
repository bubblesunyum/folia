import type { MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { loadProject, type ProjectDoc } from '../content/load'
import { MarkdownView } from '../content/MarkdownView'

export function loader(): ProjectDoc {
  return loadProject()
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData === undefined ? 'cortico' : loaderData.title },
  { name: 'description', content: loaderData?.summary ?? 'cortico, a solarpunk forum' },
]

export default function Cortico({ loaderData }: { loaderData: ProjectDoc }) {
  return (
    <article className="route-content">
      <h1>{loaderData.title}</h1>
      <MarkdownView blocks={loaderData.blocks} />
      <h2>case studies</h2>
      <ul>
        {loaderData.cases.map((c) => (
          <li key={c.slug}>
            <Link to={`/cortico/${c.slug}`} prefetch="intent">
              {c.title}
            </Link>{' '}
            — {c.summary}
          </li>
        ))}
      </ul>
    </article>
  )
}
