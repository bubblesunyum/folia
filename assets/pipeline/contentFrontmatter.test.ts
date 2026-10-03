import type { Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import { extractFrontmatter, foliaContentFrontmatter, isFrontmatterId } from './contentFrontmatter'

const RAW =
  '---\ntitle: platform\nkind: panel\n---\n\n# platform\n\nhow cortico holds large conversations.\n'

describe('isFrontmatterId', () => {
  it('matches only mdx ids on the metadata query', () => {
    expect(isFrontmatterId('/root/content/cortico/platform.mdx?frontmatter')).toBe(true)
    expect(isFrontmatterId('/root/content/cortico/platform.mdx?raw')).toBe(false)
    expect(isFrontmatterId('/root/content/cortico/platform.mdx')).toBe(false)
    expect(isFrontmatterId('/root/content/note.txt?frontmatter')).toBe(false)
  })
})

describe('extractFrontmatter', () => {
  it('keeps the fenced block and strips the body', () => {
    const stripped = extractFrontmatter(RAW, 'content/cortico/platform.mdx')
    expect(stripped).toContain('title: platform')
    expect(stripped).not.toContain('how cortico holds large conversations')
    expect(stripped).not.toContain('# platform')
  })

  it('fails closed on missing fences', () => {
    expect(() => extractFrontmatter('# no fence\n', 'f.mdx')).toThrow(/missing opening/)
    expect(() => extractFrontmatter('---\ntitle: x\n', 'f.mdx')).toThrow(/missing closing/)
  })
})

describe('foliaContentFrontmatter', () => {
  it('ignores non-frontmatter ids', () => {
    const plugin = foliaContentFrontmatter() as Plugin & {
      load: (id: string) => unknown
    }
    expect(plugin.load.call({ addWatchFile: () => {} }, '/root/content/a.mdx?raw')).toBeNull()
  })

  it('emits a string default export without the body', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    // Scratch lives in the repo .tmp (gitignored), never the system temp dir.
    mkdirSync(join(process.cwd(), '.tmp'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), '.tmp', 'folia-frontmatter-'))
    try {
      const file = join(dir, 'case.mdx')
      writeFileSync(file, RAW)
      const watched: string[] = []
      const plugin = foliaContentFrontmatter() as Plugin & {
        load: (id: string) => string | null
      }
      const code = plugin.load.call(
        { addWatchFile: (f: string) => void watched.push(f) },
        `${file}?frontmatter`,
      )
      expect(watched).toEqual([file])
      expect(code?.startsWith('export default ')).toBe(true)
      const exported: unknown = JSON.parse(code?.slice('export default '.length) ?? 'null')
      expect(typeof exported).toBe('string')
      expect(exported).toContain('title: platform')
      expect(exported).not.toContain('how cortico holds large conversations')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
