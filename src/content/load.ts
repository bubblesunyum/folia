// Loads the MDX content files into validated, route-ready data (D-019).
// Serializable frontmatter only: bodies render through the build-time
// compiled components in ./bodies, so loader data JSON-round-trips and never
// carries component functions through router serialization. The content
// directory is the single source of truth: one `?raw` eager glob inlines the
// files as strings in both the client and the prerender/SSR builds, so a new
// .mdx with valid frontmatter appears in routing and prerender with no other
// edit. The glob runs inside a memoized getter, not at module top level, so
// importing this module without a Vite transform (Playwright) never touches
// `import.meta.glob` — first use throws fail-closed there instead. Pure and
// three-free, so loaders can import this in the SSR graph (D-047).

import { splitFrontmatter } from './frontmatter'
import {
  assertTopLevelSlug,
  assertUniqueSlugs,
  type CaseKind,
  type CaseObject,
  caseFrontmatterSchema,
  projectFrontmatterSchema,
  townFrontmatterSchema,
} from './schema'

/** Every content file, inlined as a string: the single source (fol-ya7). */
let contentCache: Record<string, string> | null = null

/**
 * Memoized content map. The `import.meta.glob` call lives here — not at
 * module top level — so importing this module under raw Node (Playwright,
 * no Vite transform) never executes the glob. Under Vite the call is
 * identical to the old eager top-level glob; without a Vite transform it
 * throws fail-closed at first use instead of returning empty. The call
 * must reference `import.meta.glob` by its full name with a literal
 * pattern: Vite statically replaces that exact form, and an aliased
 * reference breaks the transform.
 */
function contentRaw(): Record<string, string> {
  if (contentCache !== null) return contentCache
  try {
    contentCache = import.meta.glob<string>('../../content/**/*.mdx', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
  } catch {
    throw new Error('content: import.meta.glob is unavailable outside the Vite build')
  }
  return contentCache
}

const CONTENT_PREFIX = '../../content/'
const TOWN_FILE = `${CONTENT_PREFIX}index.mdx`

/** The `<project>/<case>` behind a content key, or null for index files. */
function parseContentKey(key: string): { project: string; slug: string } | null {
  if (!key.startsWith(CONTENT_PREFIX) || !key.endsWith('.mdx')) return null
  const rest = key.slice(CONTENT_PREFIX.length, -'.mdx'.length)
  const parts = rest.split('/')
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    const [project, slug] = parts
    if (slug !== 'index' && project.length > 0 && slug.length > 0) return { project, slug }
  }
  return null
}

function readContent(key: string): string {
  const raw = contentRaw()[key]
  if (raw === undefined) throw new Error(`missing content source "${key}"`)
  return raw
}

export interface TownDoc {
  title: string
  summary: string
}

export interface CaseDoc {
  slug: string
  title: string
  kind: CaseKind
  summary: string
  object: CaseObject
}

export interface ProjectDoc {
  slug: string
  title: string
  summary: string
  neon: string
  cases: CaseDoc[]
}

/** Every project with an index file, sorted: adding `content/<name>/index.mdx` adds a route. */
export function listProjects(): string[] {
  const projects = new Set<string>()
  for (const key of Object.keys(contentRaw())) {
    if (key === TOWN_FILE) continue
    if (!key.startsWith(CONTENT_PREFIX) || !key.endsWith('/index.mdx')) continue
    const rest = key.slice(CONTENT_PREFIX.length, -'/index.mdx'.length)
    if (rest.length > 0 && !rest.includes('/')) projects.add(rest)
  }
  return [...projects].sort()
}

/** Every case slug in `project`, sorted: adding `content/<project>/<slug>.mdx` adds a route. */
export function listCases(project: string): string[] {
  const slugs: string[] = []
  for (const key of Object.keys(contentRaw())) {
    const parsed = parseContentKey(key)
    if (parsed !== null && parsed.project === project) slugs.push(parsed.slug)
  }
  return slugs.sort()
}

/** Every static path the content implies: `/`, each project, each case. */
export function listPrerenderPaths(): string[] {
  const paths = ['/']
  for (const project of listProjects()) {
    paths.push(`/${project}`)
    for (const slug of listCases(project)) paths.push(`/${project}/${slug}`)
  }
  return paths
}

export function loadTown(): TownDoc {
  const { data } = splitFrontmatter(readContent(TOWN_FILE), 'content/index.mdx')
  return townFrontmatterSchema.parse(data)
}

function loadCase(project: string, slug: string, raw: string): CaseDoc {
  const file = `content/${project}/${slug}.mdx`
  const { data } = splitFrontmatter(raw, file)
  const frontmatter = caseFrontmatterSchema.parse(data)
  return { slug, ...frontmatter }
}

/** The project page with its cases; throws on an unknown project (fail closed). */
export function loadProject(slug: string): ProjectDoc {
  assertTopLevelSlug(slug, `content/${slug}/index.mdx`)
  const indexKey = `${CONTENT_PREFIX}${slug}/index.mdx`
  if (contentRaw()[indexKey] === undefined) throw new Error(`unknown project "${slug}"`)
  const { data } = splitFrontmatter(readContent(indexKey), `content/${slug}/index.mdx`)
  const frontmatter = projectFrontmatterSchema.parse(data)
  const slugs = listCases(slug)
  assertUniqueSlugs(slugs, `content/${slug}`)
  const cases = slugs.map((caseSlug) =>
    loadCase(slug, caseSlug, readContent(`${CONTENT_PREFIX}${slug}/${caseSlug}.mdx`)),
  )
  return { slug, ...frontmatter, cases }
}
