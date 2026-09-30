// Loads the MDX content files into validated, route-ready data (D-019).
// Static `?raw` imports inline the files as strings in both the client and
// the prerender/SSR builds. Pure and three-free, so loaders can import this
// in the SSR graph (D-047).

import corticoIndexRaw from '../../content/cortico/index.mdx?raw'
import medleyRaw from '../../content/cortico/medley.mdx?raw'
import platformRaw from '../../content/cortico/platform.mdx?raw'
import recorderRaw from '../../content/cortico/recorder.mdx?raw'
import townRaw from '../../content/index.mdx?raw'
import { splitFrontmatter } from './frontmatter'
import { type Block, parseMarkdown } from './markdown'
import {
  assertTopLevelSlug,
  assertUniqueSlugs,
  type CaseKind,
  type CaseObject,
  caseFrontmatterSchema,
  projectFrontmatterSchema,
  townFrontmatterSchema,
} from './schema'

export interface TownDoc {
  title: string
  summary: string
  blocks: Block[]
}

export interface CaseDoc {
  slug: string
  title: string
  kind: CaseKind
  summary: string
  object: CaseObject
  blocks: Block[]
}

export interface ProjectDoc {
  slug: string
  title: string
  summary: string
  neon: string
  blocks: Block[]
  cases: CaseDoc[]
}

const PROJECT_SLUG = 'cortico'
const CASE_SOURCES: Readonly<Record<string, string>> = {
  platform: platformRaw,
  recorder: recorderRaw,
  medley: medleyRaw,
}

export function loadTown(): TownDoc {
  const { data, body } = splitFrontmatter(townRaw, 'content/index.mdx')
  const frontmatter = townFrontmatterSchema.parse(data)
  return { ...frontmatter, blocks: dropLeadingTitle(parseMarkdown(body)) }
}

function loadCase(slug: string, raw: string): CaseDoc {
  const file = `content/cortico/${slug}.mdx`
  const { data, body } = splitFrontmatter(raw, file)
  const frontmatter = caseFrontmatterSchema.parse(data)
  return { slug, ...frontmatter, blocks: dropLeadingTitle(parseMarkdown(body)) }
}

/**
 * A leading `# title` in the body would double the page heading: the
 * frontmatter title owns it (routes and the panel render it), so the loader
 * drops a depth-1 opener. Bodies that open on prose are untouched.
 */
function dropLeadingTitle(blocks: Block[]): Block[] {
  const [first, ...rest] = blocks
  return first?.type === 'heading' && first.depth === 1 ? rest : blocks
}

export function loadProject(): ProjectDoc {
  const slug = PROJECT_SLUG
  assertTopLevelSlug(slug, `content/${slug}/index.mdx`)
  const { data, body } = splitFrontmatter(corticoIndexRaw, 'content/cortico/index.mdx')
  const frontmatter = projectFrontmatterSchema.parse(data)
  const slugs = Object.keys(CASE_SOURCES)
  assertUniqueSlugs(slugs, 'content/cortico')
  const cases = slugs.map((caseSlug) => {
    const raw = CASE_SOURCES[caseSlug]
    if (raw === undefined) throw new Error(`missing source for case "${caseSlug}"`)
    return loadCase(caseSlug, raw)
  })
  return { slug, ...frontmatter, blocks: dropLeadingTitle(parseMarkdown(body)), cases }
}
