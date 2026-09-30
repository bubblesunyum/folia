import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { type CaseDoc, loadProject } from '../content/load'
import { PanelPresenter } from '../panel/PanelPresenter'

interface CasePage extends CaseDoc {
  projectSlug: string
  projectTitle: string
}

export function loader({ params }: LoaderFunctionArgs): CasePage {
  const project = loadProject()
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
