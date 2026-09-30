import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdown'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists, links and bold', () => {
    const blocks = parseMarkdown(
      '# town\n\nhello **world**\n\n## cases\n\n- [platform](/cortico/platform)\n- recorder\n',
    )
    expect(blocks).toEqual([
      { type: 'heading', depth: 1, text: [{ text: 'town' }] },
      {
        type: 'paragraph',
        text: [{ text: 'hello ' }, { text: 'world', bold: true }],
      },
      { type: 'heading', depth: 2, text: [{ text: 'cases' }] },
      {
        type: 'list',
        items: [[{ text: 'platform', href: '/cortico/platform' }], [{ text: 'recorder' }]],
      },
    ])
  })

  it('joins wrapped paragraph lines', () => {
    expect(parseMarkdown('one\ntwo\n')).toEqual([
      { type: 'paragraph', text: [{ text: 'one two' }] },
    ])
  })

  it('returns no blocks for an empty body', () => {
    expect(parseMarkdown('\n')).toEqual([])
  })
})

describe('parseInline', () => {
  it('keeps plain text whole', () => {
    expect(parseInline('plain text')).toEqual([{ text: 'plain text' }])
  })
})
