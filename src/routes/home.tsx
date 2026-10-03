import { Suspense } from 'react'
import type { MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { townBody, warmTownBody } from '../content/bodies'
import { loadTown, type TownDoc } from '../content/load'
import { mdxComponents } from '../content/mdx-components'

export async function loader(): Promise<TownDoc> {
  // Warm the town body chunk while the router waits: the render below then
  // resolves synchronously on prerender and navigation (fol-kes.9). Loader
  // data stays serializable frontmatter — the component never crosses it.
  await warmTownBody()
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
      <Suspense fallback={null}>
        <Body components={mdxComponents} />
      </Suspense>
      <p>
        <Link to="/cortico" prefetch="intent">
          cortico
        </Link>
      </p>
    </article>
  )
}
