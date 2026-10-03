import type { MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { townBody } from '../content/bodies'
import { loadTown, type TownDoc } from '../content/load'
import { mdxComponents } from '../content/mdx-components'

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
  const Body = townBody()
  return (
    <article className="route-content">
      <h1>{loaderData.title}</h1>
      <Body components={mdxComponents} />
      <p>
        <Link to="/cortico" prefetch="intent">
          cortico
        </Link>
      </p>
    </article>
  )
}
