import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  it('splits fences, keys and body', () => {
    const { data, body } = splitFrontmatter(
      '---\ntitle: cortico\nneon: mint\n---\n\n# hello\n',
      'content/cortico/index.mdx',
    )
    expect(data).toEqual({ title: 'cortico', neon: 'mint' })
    expect(body).toBe('# hello')
  })

  it('unquotes single and double quoted values', () => {
    const { data } = splitFrontmatter('---\ntitle: "a: b"\n---\n', 'f.mdx')
    expect(data).toEqual({ title: 'a: b' })
  })

  it('fails closed on missing fences, bad keys and duplicates', () => {
    expect(() => splitFrontmatter('# no fence\n', 'f.mdx')).toThrow()
    expect(() => splitFrontmatter('---\ntitle: x\n', 'f.mdx')).toThrow()
    expect(() => splitFrontmatter('---\nno colon here\n---\n', 'f.mdx')).toThrow()
    expect(() => splitFrontmatter('---\n9lives: x\n---\n', 'f.mdx')).toThrow()
    expect(() => splitFrontmatter('---\ntitle: a\ntitle: b\n---\n', 'f.mdx')).toThrow()
  })
})
