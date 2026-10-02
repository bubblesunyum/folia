import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '@react-router/dev/config'

/**
 * Every static path the content directory implies: `/`, each
 * `content/<project>/index.mdx`, each `content/<project>/<slug>.mdx`. This
 * mirrors the client glob in src/content/load.ts (which can't run here —
 * this file executes in Node, not through Vite), so both read the same
 * single source: the content files. A new .mdx prerenders with no other
 * edit; the prerender test pins the two lists equal (fol-ya7).
 */
function contentPaths(): string[] {
  const contentDir = join(import.meta.dirname, 'content')
  const paths = ['/']
  const projects = readdirSync(contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
  for (const project of projects) {
    if (!existsSync(join(contentDir, project, 'index.mdx'))) continue
    paths.push(`/${project}`)
    const cases = readdirSync(join(contentDir, project))
      .filter((f) => f.endsWith('.mdx') && f !== 'index.mdx')
      .map((f) => f.slice(0, -'.mdx'.length))
      .sort()
    for (const slug of cases) paths.push(`/${project}/${slug}`)
  }
  return paths
}

export default {
  // Routes live under src/ instead of the default app/ directory.
  appDirectory: 'src',
  // Fully static: no runtime server, every route prerendered (D-003).
  ssr: false,
  // All routes load with the initial document: no runtime route manifest to
  // fetch from the static host.
  routeDiscovery: { mode: 'initial' },
  // Derived from the content directory: adding a case study MDX prerenders
  // with no other edit.
  prerender: () => contentPaths(),
} satisfies Config
