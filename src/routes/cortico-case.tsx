import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { type CaseDoc, loadProject, type ProjectDoc } from '../content/load'
import { neighborhoodSignature } from '../palette'
import { PanelPresenter } from '../panel/PanelPresenter'

interface CasePage extends CaseDoc {
  projectSlug: string
  projectTitle: string
}

export function loader({ params }: LoaderFunctionArgs): CasePage {
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
  return { ...found, projectSlug: project.slug, projectTitle: project.title }
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  {
    title:
      loaderData === undefined ? 'case study' : `${loaderData.title} — ${loaderData.projectTitle}`,
  },
  { name: 'description', content: loaderData?.summary ?? 'a cortico case study' },
]

export default function CorticoCase({ loaderData }: { loaderData: CasePage }) {
  return <PanelPresenter content={loaderData} />
}
