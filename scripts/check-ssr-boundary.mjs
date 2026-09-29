// Fails verify if three or R3F enter the initial module graph (D-047, fol-v1n).
//
// D-059's one-off grep only saw direct imports in src/shell/**. The real trap
// is transitive: a shell file importing a helper that imports three (spike 7
// nearly did exactly this with the zoom event constants). So this walks the
// static import graph from index.html's module scripts and fails closed:
// every reachable bare specifier must be on ALLOWLIST (react only —
// everything else, including three-ecosystem packages like `postprocessing`
// that carry three without naming it, is a violation), and every relative or
// root-absolute specifier must resolve to a walked file. Exotic specifiers
// (virtual:, ?worker) take the bare-specifier path and fail as outside ALLOWLIST.
// Dynamic `import()` is the sanctioned lazy boundary (App's TownCanvas and
// LevaPanel) and is not followed; statement-level `import type` is erased at
// build and is not followed either.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** The only bare packages the initial graph may contain. */
const ALLOWLIST = [/^react(-dom)?(\/|$)/]
/** Three-ecosystem patterns, for a diagnostic that names the real problem. */
const DENYLIST = [/three/i, /^@react-three\//, /^stats-gl(\/|$)/]

const STATIC_FROM =
  /(?:^|[;}\n])\s*import\s+(type\b)?([^'"]*?)\sfrom\s*['"]([^'"]+)['"]/g
const STATIC_SIDE_EFFECT = /(?:^|[;}\n])\s*import\s*['"]([^'"]+)['"]/g
const STATIC_EXPORT_FROM = /export\s+(type\b)?([^'"]*?)\sfrom\s*['"]([^'"]+)['"]/g
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const SCRIPT_OPEN = /<script\b[^>]*>/g
const SCRIPT_BLOCK = /<script\b[^>]*type\s*=\s*(["'])module\1[^>]*>([\s\S]*?)<\/script\s*>/g

function fail(...lines) {
  for (const line of lines) console.error(`ssr-boundary: ${line}`)
  process.exit(1)
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * Blank comments length-preservingly without touching string literals, so a
 * `//` inside a string can't eat a real import and reported lines still point
 * at the original file.
 */
function blankComments(text) {
  const blank = (chunk) => chunk.replace(/[^\n]/g, ' ')
  let out = ''
  let i = 0
  let quote = null
  while (i < text.length) {
    const char = text[i]
    if (quote !== null) {
      out += char
      if (char === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (char === quote) quote = null
      i += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      i += 1
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? text.length : end
      out += blank(text.slice(i, stop))
      i = stop
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      out += blank(text.slice(i, stop))
      i = stop
      continue
    }
    out += char
    i += 1
  }
  return out
}

// A default import literally named `type` (`import type from './x'`) is a
// runtime import, not erasure: only excuse `type` followed by a real clause.
const isTypeErased = (type, middle) =>
  type !== undefined && /^\s*(\{|\*|[A-Za-z_$][\w$]*)/.test(middle)

/**
 * Spans of string content in already comment-blanked text, so an `import` or
 * `require` keyword inside a string (an error message, a docstring) is never
 * mistaken for a real statement. Template `${}` regions count as code.
 */
function stringSpans(text) {
  const spans = []
  const stack = []
  let segStart = -1
  let i = 0
  while (i < text.length) {
    const char = text[i]
    const top = stack[stack.length - 1]
    if (!top) {
      if (char === "'" || char === '"' || char === '`') {
        stack.push({ quote: char, braces: 0 })
        segStart = i + 1
      }
      i += 1
      continue
    }
    if (top.quote === '`' && top.braces === 0 && char === '$' && text[i + 1] === '{') {
      spans.push([segStart, i])
      stack.push({ quote: '}', braces: 0 })
      i += 2
      continue
    }
    if (top.quote === '}') {
      if (char === "'" || char === '"' || char === '`') {
        stack.push({ quote: char, braces: 0 })
        segStart = i + 1
      } else if (char === '{') {
        top.braces += 1
      } else if (char === '}') {
        if (top.braces === 0) {
          stack.pop()
          segStart = i + 1
        } else {
          top.braces -= 1
        }
      }
      i += 1
      continue
    }
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === top.quote) {
      spans.push([segStart, i])
      stack.pop()
    }
    i += 1
  }
  return spans
}

function inString(spans, pos) {
  return spans.some(([start, end]) => pos >= start && pos < end)
}

/**
 * Module scripts in index.html are the graph roots: external `src` files plus
 * inline bodies (walked as units rooted at ROOT).
 */
function entryUnits() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const units = []
  for (const open of html.matchAll(SCRIPT_OPEN)) {
    if (!/type\s*=\s*["']module["']/.test(open[0])) continue
    const src = open[0].match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1]
    if (src) {
      const line = lineNumberAt(html, open.index ?? 0)
      if (!src.startsWith('/src/')) fail(`index.html:${line}: module src '${src}' is not under /src/`)
      const file = join(ROOT, src.slice(1))
      if (!existsSync(file)) fail(`index.html:${line}: entry not found: ${src}`)
      units.push({ key: file, dir: dirname(file), file })
    }
  }
  for (const block of html.matchAll(SCRIPT_BLOCK)) {
    const line = lineNumberAt(html, block.index ?? 0)
    if (block[2].trim() !== '') {
      units.push({
        key: `index.html#inline-${line}`,
        dir: ROOT,
        text: block[2],
        label: `index.html:${line} (inline)`,
      })
    }
  }
  if (units.length === 0) fail('index.html: no module scripts found')
  return units
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

function resolveRelative(dir, spec, where) {
  if (spec.startsWith('/') && !spec.startsWith('/src/')) {
    fail(`${where}: absolute import '${spec}' is not under /src/`)
  }
  const base = spec.startsWith('/') ? join(ROOT, spec.slice(1)) : resolve(dir, spec)
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`)
    if (existsSync(index)) return index
  }
  fail(`${where}: unresolvable import '${spec}'`)
  return null
}

function collectImports(text) {
  // Dynamic import() is the lazy boundary: blank it length-preserving so the
  // line numbers below still point at the original file.
  const blinded = text.replace(/\bimport\s*\(/g, (match) => ' '.repeat(match.length))
  const spans = stringSpans(blinded)
  const specLine = (match, spec) =>
    lineNumberAt(text, (match.index ?? 0) + match[0].lastIndexOf(spec))
  // The statement keyword must be real code, not string content (an error
  // message mentioning require('x') is not an import).
  const keywordAt = (match, word) => (match.index ?? 0) + match[0].indexOf(word)
  const found = []
  for (const match of blinded.matchAll(STATIC_FROM)) {
    if (inString(spans, keywordAt(match, 'import'))) continue
    if (isTypeErased(match[1], match[2])) continue
    found.push({ spec: match[3], line: specLine(match, match[3]) })
  }
  for (const match of blinded.matchAll(STATIC_SIDE_EFFECT)) {
    if (inString(spans, keywordAt(match, 'import'))) continue
    found.push({ spec: match[1], line: specLine(match, match[1]) })
  }
  for (const match of blinded.matchAll(STATIC_EXPORT_FROM)) {
    if (inString(spans, keywordAt(match, 'export'))) continue
    if (isTypeErased(match[1], match[2])) continue
    found.push({ spec: match[3], line: specLine(match, match[3]) })
  }
  for (const match of blinded.matchAll(REQUIRE)) {
    if (inString(spans, match.index ?? 0)) continue
    found.push({ spec: match[1], line: specLine(match, match[1]) })
  }
  return found
}

function relativePath(abs) {
  return abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : abs
}

function isDenied(spec) {
  return DENYLIST.some((pattern) => pattern.test(spec))
}

function checkBare(spec, where, chain, violations) {
  // Chain is stored entry-first, so `->` follows the import direction.
  const via = chain.length > 0 ? ` via ${[...chain, where].join(' -> ')}` : ''
  if (ALLOWLIST.some((pattern) => pattern.test(spec))) return
  if (isDenied(spec)) {
    violations.push(`  ${spec} reached from ${where}${via} (three/R3F in the initial graph)`)
  } else {
    violations.push(
      `  ${spec} reached from ${where}${via} (bare import outside ALLOWLIST — add it or move it behind dynamic import())`,
    )
  }
}

const visited = new Set()
const violations = []
const stack = entryUnits().map((unit) => ({ unit, chain: [] }))

while (stack.length > 0) {
  const { unit, chain } = stack.pop()
  if (visited.has(unit.key)) continue
  visited.add(unit.key)
  const text =
    unit.text ?? (existsSync(unit.file) ? readFileSync(unit.file, 'utf8') : null)
  if (text === null) fail(`entry not found: ${relativePath(unit.file)}`)
  const where = (line) => `${unit.label ?? relativePath(unit.file)}:${line}`
  for (const { spec, line } of collectImports(blankComments(text))) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // Bare specifier: node_modules is never walked, so the allowlist is
      // the whole decision. Exotic loaders (virtual:, ?worker) land here too.
      checkBare(spec, where(line), chain, violations)
      continue
    }
    const next = resolveRelative(unit.dir, spec, where(line))
    if (!next.startsWith(`${ROOT}/`)) {
      fail(`${where(line)}: import '${spec}' escapes the repo — move it inside or extend the checker`)
    }
    if (!visited.has(next)) {
      stack.push({
        unit: { key: next, dir: dirname(next), file: next },
        chain: [...chain, where(line)],
      })
    }
  }
}

if (violations.length > 0) {
  fail(
    'initial module graph violation:',
    ...violations,
    'move it behind dynamic import() (see App.tsx) so it leaves the initial graph.',
  )
}

console.log(`ssr-boundary: ok (${visited.size} units reachable, initial graph is react-only)`)
