// The build-time frontmatter strip (fol-kes.9, D-019): the eager metadata
// glob in src/content/load.ts inlines every content file into each chunk
// that imports it, so the body copy is cut here at build time and only the
// `---`-fenced frontmatter block reaches the bundle. Runtime parsing and
// zod validation in load.ts are untouched — malformed files still fail
// closed there, and this transform throws fail-closed here first, so a
// fence-less file breaks the build instead of shipping an empty export.
// Pure Node in the config graph only: never imported by src/ (D-047).

import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { extractFrontmatterSource } from '../../src/content/frontmatter.ts'

/** The glob query load.ts uses for the metadata path. */
export const FRONTMATTER_QUERY = '?frontmatter'

/** True when a Vite module id is a content file on the metadata path. */
export function isFrontmatterId(id: string): boolean {
  return id.endsWith(`.mdx${FRONTMATTER_QUERY}`)
}

/**
 * The fenced frontmatter block of `raw`, body stripped, fences included so
 * the runtime splitter sees the shape it validates. Throws fail-closed on
 * a missing fence, mirroring splitFrontmatter's contract. Delimiter parsing
 * is owned by src/content/frontmatter — this stays a thin Node wrapper so
 * only one fence scanner exists.
 */
export function extractFrontmatter(raw: string, file: string): string {
  return extractFrontmatterSource(raw, file)
}

export function foliaContentFrontmatter(): Plugin {
  return {
    name: 'folia-content-frontmatter',
    // Before the MDX compile: a `?frontmatter` id matches the plugin's
    // query-stripped path, so without `pre` the body compiler would claim
    // the module first and destroy the frontmatter string.
    enforce: 'pre',
    load(id) {
      if (!isFrontmatterId(id)) return null
      const file = id.slice(0, -FRONTMATTER_QUERY.length)
      const raw = readFileSync(file, 'utf8')
      // Content edits re-strip in dev: files read here are not watched by
      // default, so register the source explicitly.
      this.addWatchFile(file)
      return `export default ${JSON.stringify(extractFrontmatter(raw, file))}`
    },
  }
}
