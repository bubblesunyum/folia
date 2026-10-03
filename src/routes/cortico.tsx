import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { projectBody } from '../content/bodies'
import { loadProject, type ProjectDoc } from '../content/load'
import { mdxComponents } from '../content/mdx-components'
import { signalFocusLift } from '../input/intent'
import { neighborhoodSignature } from '../palette'
import { usePedestalRouteSync } from '../panel/usePedestalRouteSync'

export function loader({ params }: LoaderFunctionArgs): ProjectDoc {
  if (params.project === undefined) throw new Response('missing project', { status: 404 })
  // The canvas throws on a hood with no signature entry (fail closed), so
  // the boundary 404s it here instead: content without a signature never
  // reaches the materials mid-render.
  if (!(params.project in neighborhoodSignature)) {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
  try {
    return loadProject(params.project)
  } catch {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData === undefined ? 'cortico' : loaderData.title },
  { name: 'description', content: loaderData?.summary ?? 'cortico, a solarpunk forum' },
]

export default function Cortico({ loaderData }: { loaderData: ProjectDoc }) {
  // Pedestal clicks land here from the canvas rig; case-link focus drives
  // the same 3D lift+glow as hover through the intent layer (spec keyboard).
  usePedestalRouteSync()
  const Body = projectBody(loaderData.slug)
  return (
    <article className="route-content">
      <h1>{loaderData.title}</h1>
      <Body components={mdxComponents} />
      <h2>case studies</h2>
      <ul>
        {loaderData.cases.map((c) => (
          <li key={c.slug}>
            <CaseLink slug={c.slug} title={c.title} /> — {c.summary}
          </li>
        ))}
      </ul>
    </article>
  )
}

function CaseLink({ slug, title }: { slug: string; title: string }) {
  return (
    <Link
      to={slug}
      prefetch="intent"
      data-pedestal={slug}
      onFocus={() => signalFocusLift(slug)}
      onBlur={() => signalFocusLift('')}
    >
      {title}
    </Link>
  )
}
