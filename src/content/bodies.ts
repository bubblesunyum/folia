// The compiled MDX bodies (D-019, fol-kes.9): one lazy glob maps every
// content file to its own chunk, so a route loads only the body it renders —
// the old eager glob inlined all files (raw and compiled) into each importing
// chunk. Frontmatter stays in the `?frontmatter` path in load.ts — this
// module only resolves renderable bodies by slug.
//
// Two reads share one cache. Route loaders `await` the warm function first
// (serializable frontmatter still owns the loader data; the warmed component
// never crosses it), so prerender and client navigation render the real
// component synchronously and the static HTML is unchanged. Client hydration
// never re-runs loaders, so the sync read falls back to a cached `lazy`
// wrapper behind the route's Suspense boundary instead. The glob runs inside
// a memoized getter, not at module top level, so importing this module
// without a Vite transform (Playwright) never touches `import.meta.glob` —
// first use throws fail-closed there instead. The glob call must reference
// `import.meta.glob` by its full name with a literal pattern: Vite
// statically replaces that exact form, and an aliased reference breaks the
// transform.

import type { ComponentType } from 'react'
import { lazy } from 'react'
import type { MdxComponents } from './mdx-components'

export type MdxBody = ComponentType<{ components?: MdxComponents }>

type BodyModule = { default: MdxBody }
type BodyLoader = () => Promise<BodyModule>

/** Every content module's loader: one lazy chunk per file. */
let loaderCache: Record<string, BodyLoader> | null = null

function bodyLoaders(): Record<string, BodyLoader> {
  if (loaderCache !== null) return loaderCache
  try {
    loaderCache = import.meta.glob<BodyModule>('../../content/**/*.mdx')
  } catch {
    throw new Error('content: import.meta.glob is unavailable outside the Vite build')
  }
  return loaderCache
}

/** Bodies warmed by route loaders: the synchronous render path. */
const warmed = new Map<string, MdxBody>()
/** Cached lazy wrappers for the not-yet-warmed path (client hydration). */
const lazyCache = new Map<string, MdxBody>()

const CONTENT_PREFIX = '../../content/'

function loaderFor(key: string): BodyLoader {
  const load = bodyLoaders()[key]
  if (load === undefined) throw new Error(`missing content body "${key}"`)
  return load
}

/**
 * Await this in the route loader before rendering: the chunk loads while the
 * router waits, so the component below resolves synchronously. Returns the
 * warmed component for tests.
 */
export async function warmBody(key: string): Promise<MdxBody> {
  const hit = warmed.get(key)
  if (hit !== undefined) return hit
  const body = (await loaderFor(key)()).default
  warmed.set(key, body)
  return body
}

/**
 * The body for a content file: the warmed component when its route loader
 * ran (prerender, client navigation, warmed tests), else a cached `lazy`
 * wrapper that resolves to the same component — render behind Suspense.
 * Throws fail-closed on unknown keys and on renders no loader warmed and
 * no chunk provides (never a silent empty article).
 */
function bodyForKey(key: string): MdxBody {
  const hit = warmed.get(key)
  if (hit !== undefined) return hit
  let lazyBody = lazyCache.get(key)
  if (lazyBody === undefined) {
    const load = loaderFor(key)
    lazyBody = lazy(() =>
      load().then((module) => {
        warmed.set(key, module.default)
        return module
      }),
    )
    lazyCache.set(key, lazyBody)
  }
  return lazyBody
}

/** Warm the compiled town body (`content/index.mdx`) in the home loader. */
export function warmTownBody(): Promise<MdxBody> {
  return warmBody(`${CONTENT_PREFIX}index.mdx`)
}

/** The compiled town body (`content/index.mdx`). */
export function townBody(): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}index.mdx`)
}

/** Warm the compiled project body (`content/<project>/index.mdx`) in its loader. */
export function warmProjectBody(project: string): Promise<MdxBody> {
  return warmBody(`${CONTENT_PREFIX}${project}/index.mdx`)
}

/** The compiled project body (`content/<project>/index.mdx`). */
export function projectBody(project: string): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}${project}/index.mdx`)
}

/** Warm the compiled case body (`content/<project>/<slug>.mdx`) in its loader. */
export function warmCaseBody(project: string, slug: string): Promise<MdxBody> {
  return warmBody(`${CONTENT_PREFIX}${project}/${slug}.mdx`)
}

/** The compiled case body (`content/<project>/<slug>.mdx`). */
export function caseBody(project: string, slug: string): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}${project}/${slug}.mdx`)
}
