// Minimal frontmatter split for the MDX content files: `---`-delimited flat
// `key: value` scalars only. Anything fancier fails closed, so a malformed
// file breaks the build instead of shipping silent empty content. Pure and
// three-free (D-047).

const FRONTMATTER_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/

export function splitFrontmatter(
  raw: string,
  file: string,
): {
  data: Record<string, string>
  body: string
} {
  const lines = raw.split('\n')
  const first = lines[0]
  if (first === undefined || first.trim() !== '---') {
    throw new Error(`${file}: missing opening --- frontmatter fence`)
  }
  const data: Record<string, string> = {}
  let i = 1
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined) break
    if (line.trim() === '---') break
    const colon = line.indexOf(':')
    if (colon < 0) throw new Error(`${file}:${i + 1}: frontmatter wants "key: value"`)
    const key = line.slice(0, colon).trim()
    if (!FRONTMATTER_KEY.test(key)) {
      throw new Error(`${file}:${i + 1}: bad frontmatter key "${key}"`)
    }
    if (key in data) throw new Error(`${file}:${i + 1}: duplicate frontmatter key "${key}"`)
    data[key] = unquote(line.slice(colon + 1).trim(), file, i + 1)
  }
  if (i >= lines.length) throw new Error(`${file}: missing closing --- frontmatter fence`)
  return {
    data,
    body: lines
      .slice(i + 1)
      .join('\n')
      .trim(),
  }
}

function unquote(value: string, file: string, line: number): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  if (value.includes(': ')) {
    throw new Error(`${file}:${line}: quote a value containing ": "`)
  }
  return value
}
