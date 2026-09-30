// The markdown subset the MDX bodies may use until wave 2 brings component
// directives: `#` / `##` headings, paragraphs, `- ` lists, `[text](href)`
// links and `**bold**`. Pure and three-free (D-047).

export interface Inline {
  text: string
  href?: string
  bold?: boolean
}

export type Block =
  | { type: 'heading'; depth: 1 | 2; text: Inline[] }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'list'; items: Inline[][] }

export function parseMarkdown(body: string): Block[] {
  const blocks: Block[] = []
  const paragraph: string[] = []
  let list: Inline[][] | null = null
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: parseInline(paragraph.join(' ')) })
      paragraph.length = 0
    }
  }
  const flushList = () => {
    if (list !== null) {
      blocks.push({ type: 'list', items: list })
      list = null
    }
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{1,2}) (.+)$/.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        depth: heading[1].length === 2 ? 2 : 1,
        text: parseInline(heading[2]),
      })
      continue
    }
    if (line.startsWith('- ')) {
      flushParagraph()
      if (list === null) list = []
      list.push(parseInline(line.slice(2).trim()))
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = []
  // Links first, then bold runs inside each literal span.
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let cursor = 0
  for (let match = linkPattern.exec(text); match !== null; match = linkPattern.exec(text)) {
    const index = match.index
    const label = match[1]
    const href = match[2]
    if (index > cursor) parts.push(...parseBold(text.slice(cursor, index)))
    if (label !== undefined && href !== undefined) {
      parts.push(...parseBold(label).map((part) => ({ ...part, href })))
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push(...parseBold(text.slice(cursor)))
  return parts.length > 0 ? parts : [{ text }]
}

function parseBold(text: string): Inline[] {
  const parts: Inline[] = []
  const boldPattern = /\*\*([^*]+)\*\*/g
  let cursor = 0
  for (let match = boldPattern.exec(text); match !== null; match = boldPattern.exec(text)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) })
    const inner = match[1]
    if (inner !== undefined) parts.push({ text: inner, bold: true })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}
