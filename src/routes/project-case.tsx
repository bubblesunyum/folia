import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { warmCaseBody } from '../content/bodies'
import { type CaseDoc, loadProject, type ProjectDoc } from '../content/load'
import { neighborhoodSignature } from '../palette'
import { PanelPresenter } from '../panel/PanelPresenter'

interface CasePage extends CaseDoc {
  projectSlug: string
  projectTitle: string
}

export async function loader({ params }: LoaderFunctionArgs): Promise<CasePage> {
  if (params.project === undefined) throw new Response('missing project', { status: 404 })
  // Same boundary as the project loader: a hood with no signature entry
  // 404s here rather than throwing inside the canvas mid-render.
  if (!(params.project in neighborhoodSignature)) {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
  let project: ProjectDoc
  try {
    project = loadProject(params.project)
  } catch {
    throw new Response(`unknown project "${params.project}"`, { status: 404 })
  }
  const found = project.cases.find((c) => c.slug === params.slug)
  if (found === undefined) {
    throw new Response(`unknown case "${params.slug ?? ''}"`, { status: 404 })
  }
  // Warm the case body chunk while the router waits, after the slug proves
  // known: the panel then renders it synchronously on prerender and
  // navigation (fol-kes.9). The warmed component never crosses the loader
  // boundary — loader data stays serializable frontmatter.
  await warmCaseBody(params.project, found.slug)
  return { ...found, projectSlug: project.slug, projectTitle: project.title }
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  {
    title:
      loaderData === undefined ? 'case study' : `${loaderData.title} — ${loaderData.projectTitle}`,
  },
  { name: 'description', content: loaderData?.summary ?? 'a case study' },
]

export default function ProjectCase({ loaderData }: { loaderData: CasePage }) {
  return <PanelPresenter content={loaderData} />
}
