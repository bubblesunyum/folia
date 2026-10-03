// The compiled MDX bodies (D-019): one eager glob inlines every content file
// as a build-time compiled React component, so JSX/components/expressions in
// a body just work. Frontmatter stays in the `?raw` path in load.ts — this
// module only resolves renderable bodies by slug. The glob runs inside a
// memoized getter, not at module top level, so importing this module without
// a Vite transform (Playwright) never touches `import.meta.glob` — first use
// throws fail-closed there instead. The glob call must reference
// `import.meta.glob` by its full name with a literal pattern: Vite
// statically replaces that exact form, and an aliased reference breaks the
// transform.

import type { ComponentType } from 'react'
import type { MdxComponents } from './mdx-components'

export type MdxBody = ComponentType<{ components?: MdxComponents }>

/** Every compiled content module, inlined at build time. */
let bodyCache: Record<string, { default: MdxBody }> | null = null

function bodyModules(): Record<string, { default: MdxBody }> {
  if (bodyCache !== null) return bodyCache
  try {
    bodyCache = import.meta.glob<{ default: MdxBody }>('../../content/**/*.mdx', {
      eager: true,
    })
  } catch {
    throw new Error('content: import.meta.glob is unavailable outside the Vite build')
  }
  return bodyCache
}

const CONTENT_PREFIX = '../../content/'

function bodyForKey(key: string): MdxBody {
  const module = bodyModules()[key]
  if (module === undefined) throw new Error(`missing content body "${key}"`)
  return module.default
}

/** The compiled town body (`content/index.mdx`). */
export function townBody(): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}index.mdx`)
}

/** The compiled project body (`content/<project>/index.mdx`). */
export function projectBody(project: string): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}${project}/index.mdx`)
}

/** The compiled case body (`content/<project>/<slug>.mdx`). */
export function caseBody(project: string, slug: string): MdxBody {
  return bodyForKey(`${CONTENT_PREFIX}${project}/${slug}.mdx`)
}
