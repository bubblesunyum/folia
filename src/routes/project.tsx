import { Suspense, useEffect } from 'react'
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLocation } from 'react-router'
import { projectBody, warmProjectBody } from '../content/bodies'
import { loadProject, type ProjectDoc } from '../content/load'
import { mdxComponents } from '../content/mdx-components'
import { signalFocusLift } from '../input/intent'
import { neighborhoodSignature } from '../palette'
import { takeFocusReturn } from '../panel/panelFocus'
import { usePedestalRouteSync } from '../panel/usePedestalRouteSync'
import { withQaSearch } from '../time/timeParam'

export async function loader({ params }: LoaderFunctionArgs): Promise<ProjectDoc> {
  if (params.project === undefined) throw new Response('missing project', { status: 404 })
  // The canvas throws on a hood with no signature entry (fail closed), so
  // the boundary 404s it here instead: content without a signature never
  // reaches the materials mid-render.
  if (!(params.project in neighborhoodSignature)) {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
  let project: ProjectDoc
  try {
    project = loadProject(params.project)
  } catch {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
  // Prerender only (client navigation warms in `clientLoader`), after the slug proves
  // known: chunk failure propagates instead of mapping to 404 (fol-kes.9).
  await warmProjectBody(params.project)
  return project
}

// Client navigation never runs `loader` (static build: .data payload only),
// so warm the body chunk before the route commits (fol-kes.12).
export async function clientLoader({
  serverLoader,
}: ClientLoaderFunctionArgs): Promise<ProjectDoc> {
  const data = await serverLoader<ProjectDoc>()
  await warmProjectBody(data.slug)
  return data
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData === undefined ? 'project' : loaderData.title },
  { name: 'description', content: loaderData?.summary ?? 'a project' },
]

export default function Project({ loaderData }: { loaderData: ProjectDoc }) {
  // Pedestal clicks land here from the canvas rig; case-link focus drives
  // the same 3D lift+glow as hover through the intent layer (spec keyboard).
  usePedestalRouteSync()
  // Focus return (fol-l7d.11): a closing panel hands its slug back, and the
  // place lands focus on that case link so keyboard users resume where they
  // left. Null on every other arrival, so direct loads never steal focus.
  useEffect(() => {
    const slug = takeFocusReturn()
    if (slug === null) return
    document.querySelector<HTMLElement>(`a[data-pedestal="${CSS.escape(slug)}"]`)?.focus()
  }, [])
  const Body = projectBody(loaderData.slug)
  return (
    <article className="route-content">
      <h1>{loaderData.title}</h1>
      <Suspense fallback={null}>
        <Body components={mdxComponents} />
      </Suspense>
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
  // Same QA-search carry as the town link above (fol-76l).
  const { search } = useLocation()
  return (
    <Link
      to={withQaSearch(slug, search)}
      prefetch="intent"
      data-pedestal={slug}
      onFocus={() => signalFocusLift(slug)}
      onBlur={() => signalFocusLift('')}
    >
      {title}
    </Link>
  )
}
