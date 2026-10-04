import { Suspense } from 'react'
import type { ClientLoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { townBody, warmTownBody } from '../content/bodies'
import { loadTown, type TownDoc } from '../content/load'
import { mdxComponents } from '../content/mdx-components'

export async function loader(): Promise<TownDoc> {
  // Prerender only: warms the body so the static HTML carries the real copy.
  // Loader data stays serializable frontmatter — the component never crosses.
  await warmTownBody()
  return loadTown()
}

// Client navigation never runs `loader` (fully static: it gets the .data
// payload), so warm the body chunk here before the route commits (fol-kes.12).
// Not `hydrate`: first load renders behind the Suspense boundary instead.
export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs): Promise<TownDoc> {
  const [data] = await Promise.all([serverLoader<TownDoc>(), warmTownBody()])
  return data
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
