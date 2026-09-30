import type { MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { loadTown, type TownDoc } from '../content/load'
import { MarkdownView } from '../content/MarkdownView'

export function loader(): TownDoc {
  return loadTown()
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData === undefined ? 'portfolio town' : loaderData.title },
  {
    name: 'description',
    content: loaderData?.summary ?? 'a solarpunk town portfolio, starting with cortico',
  },
]

export default function Home({ loaderData }: { loaderData: TownDoc }) {
  return (
    <article className="route-content">
      <h1>{loaderData.title}</h1>
      <MarkdownView blocks={loaderData.blocks} />
      <p>
        <Link to="/cortico" prefetch="intent">
          cortico
        </Link>
      </p>
    </article>
  )
}
