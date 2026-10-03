import mdx from '@mdx-js/rollup'
import { reactRouter } from '@react-router/dev/vite'
import remarkFrontmatter from 'remark-frontmatter'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { foliaContentFrontmatter } from './assets/pipeline/contentFrontmatter.ts'
import { foliaAssets } from './assets/pipeline/vitePlugin.ts'

/**
 * Build-time remark plugin: the frontmatter title owns the page heading
 * (routes and the panel render it), so a leading `# title` body heading is
 * dropped from the compiled MDX instead of doubling it. Frontmatter nodes
 * (`yaml`/`toml`, left in the tree by remark-frontmatter) and MDX
 * import/export statements (`mdxjsEsm`, which precede the heading in the
 * real-MDX fixture) are skipped over while the heading search runs; the
 * skipped nodes stay in the tree so imports and expressions still compile.
 * Runs at compile time only — no compiler in the browser bundle.
 */
function remarkDropLeadingTitle() {
  return (tree: unknown) => {
    if (typeof tree !== 'object' || tree === null) return
    const { children } = tree as { children?: unknown }
    if (!Array.isArray(children)) return
    let index = 0
    while (index < children.length) {
      const node = children[index] as { type?: unknown } | undefined
      if (node?.type === 'yaml' || node?.type === 'toml' || node?.type === 'mdxjsEsm') {
        index += 1
        continue
      }
      break
    }
    const first = children[index] as { type?: unknown; depth?: unknown } | undefined
    if (first?.type === 'heading' && first.depth === 1) children.splice(index, 1)
  }
}

/** Keep frontmatter-string and raw-string imports uncompiled; MDX 3 exposes a function transform. */
function skipRawIds(plugin: Plugin): Plugin {
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('MDX transform must be a function')
  return {
    ...plugin,
    transform(value, id) {
      if (id.includes('?raw') || id.includes('?frontmatter')) return null
      return transform.call(this, value, id)
    },
  }
}

const mdxPlugin = skipRawIds(
  mdx({ include: /\.mdx$/, remarkPlugins: [remarkFrontmatter, remarkDropLeadingTitle] }),
)

export default defineConfig({
  // mdx() compiles .mdx to JS components at build time (before the router's
  // React transform); remark-frontmatter keeps the `---` fences out of the
  // rendered body while the `?frontmatter` metadata path in src/content/load.ts
  // keeps owning the validated data, body text stripped at build time by
  // foliaContentFrontmatter. The `?raw`/`?frontmatter` guard above keeps string
  // imports uncompiled (the plugin matches on the query-stripped path, and compiling
  // those would destroy the raw source).
  plugins: [foliaContentFrontmatter(), mdxPlugin, reactRouter(), foliaAssets()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'assets/pipeline/**/*.test.ts'],
  },
})
