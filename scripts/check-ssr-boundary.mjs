// Fails verify if three or R3F enter the initial module graph (D-047, fol-v1n).
//
// D-059's one-off grep only saw direct imports in src/shell/**. The real trap
// is transitive: a shell file importing a helper that imports three (spike 7
// nearly did exactly this with the zoom event constants). So this walks the
// static import graph from the framework entries (src/root.tsx + src/routes/)
// and fails closed: every reachable bare specifier must be on ALLOWLIST
// (react only — everything else, including three-ecosystem packages like
// `postprocessing` that carry three without naming it, is a violation), and
// every relative or root-absolute specifier must resolve to a walked file.
// Exotic specifiers (virtual:, ?worker) take the bare-specifier path and fail
// as outside ALLOWLIST. Dynamic `import()` is the sanctioned lazy boundary
// (App's TownCanvas and LevaPanel) and is not followed; statement-level
// `import type` is erased at build and is not followed either.
//
// Parsing is es-module-lexer (fol-s4f), not hand-rolled regexes: comments,
// string literals and template `${}` regions are handled by a real ESM lexer,
// so an `import` inside an error message is never mistaken for a statement.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { init, parse } from 'es-module-lexer'
import { transformSync } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** The only bare packages the initial graph may contain. */
const ALLOWLIST = [
  /^react(-dom)?(\/|$)/,
  // The framework runtime: every route module imports its Link/loader/meta
  // types from here, and it ships no three.
  /^react-router(\/|$)/,
  // Frontmatter validation runs in the route loaders (prerender + client
  // navigation), so the schema library is in the initial graph by design.
  /^zod(\/|$)/,
]
/** Three-ecosystem patterns, for a diagnostic that names the real problem. */
const DENYLIST = [/three/i, /^@react-three\//, /^stats-gl(\/|$)/]

function fail(...lines) {
  for (const line of lines) console.error(`ssr-boundary: ${line}`)
  process.exit(1)
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length
}

// es-module-lexer v3 reports `typeOnly` natively: a default import literally
// named `type` (`import type from './x'`) is a runtime import, and only
// `typeOnly === true` is skipped.

/**
 * Graph roots. Framework mode (D-003) has no index.html: the document shell
 * is `src/root.tsx` and every route in `src/routes/` renders into it, so
 * those are the initial graph. `src/routes.ts` is build-time config (it
 * imports `@react-router/dev`) and is deliberately not a root.
 */
function entryUnits() {
  const roots = ['src/root.tsx']
  const routesDir = join(SRC, 'routes')
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__tests__') continue
      // Colocated unit tests import vitest and never ship; walking them
      // would fail the gate on a bare import outside ALLOWLIST.
      if (/[.-](test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (/\.(ts|tsx)$/.test(entry.name)) roots.push(relative(ROOT, abs))
    }
  }
  if (existsSync(routesDir)) walk(routesDir)
  const units = []
  for (const root of roots) {
    const file = join(ROOT, root)
    if (!existsSync(file)) fail(`${root}: framework entry not found`)
    units.push({ key: file, dir: dirname(file), file })
  }
  if (units.length === 0) fail('no framework entries found (src/root.tsx, src/routes/)')
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

const REQUIRE_CALL = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function collectImports(text, file) {
  const label = relativePath(file)
  // es-module-lexer reads JS: strip TS types first (fol-s4f) with esbuild.
  // Violation lines are approximate (esbuild elides type-only imports,
  // shifting lines below up); the file and the chain are exact.
  let code = text
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    try {
      code = transformSync(text, {
        loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'esm',
      }).code
    } catch (error) {
      fail(`${label}: cannot transpile (${error?.message ?? error})`)
    }
  }
  let imports
  try {
    ;[imports] = parse(code)
  } catch (error) {
    fail(`${label}: cannot parse module (${error?.message ?? error})`)
  }
  const found = []
  for (const imp of imports) {
    // Dynamic import() is the lazy boundary (v3 marks it type: 'dynamic'):
    // skip it, non-string specifiers (`import.meta` reports specifier null —
    // without this the walker below crashes on `.includes`), and `import
    // type` (erased at build).
    // Re-exports ride along: `export { a } from` is 'static' and `export *`
    // from is 'reexport-star' — both must be walked, or a three import behind
    // an `export *` would pass silently (fail-open).
    if (imp.type === 'dynamic' || typeof imp.specifier !== 'string') continue
    if (imp.typeOnly === true) continue
    found.push({ spec: imp.specifier, line: lineNumberAt(code, imp.start ?? imp.importStart) })
  }
  // require() is not ESM and the lexer never reports it, so a bare regex is
  // the only eye on it. It errs fail-closed on purpose: a `require('x')`
  // inside a string still trips the gate, and the author rewords. A require
  // of anything — even an allowlisted package — is a violation, because the
  // static graph cannot see it; use a static import instead.
  for (const match of code.matchAll(REQUIRE_CALL)) {
    found.push({
      spec: match[1],
      line: lineNumberAt(code, (match.index ?? 0) + match[0].lastIndexOf(match[1])),
      dynamic: true,
    })
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

await init()
const visited = new Set()
const violations = []
const stack = entryUnits().map((unit) => ({ unit, chain: [] }))

while (stack.length > 0) {
  const { unit, chain } = stack.pop()
  if (visited.has(unit.key)) continue
  visited.add(unit.key)
  const text = existsSync(unit.file) ? readFileSync(unit.file, 'utf8') : null
  if (text === null) fail(`entry not found: ${relativePath(unit.file)}`)
  const where = (line) => `${relativePath(unit.file)}:${line}`
  for (const { spec, line, dynamic } of collectImports(text, unit.file)) {
    if (dynamic === true) {
      const via = chain.length > 0 ? ` via ${[...chain, where(line)].join(' -> ')}` : ''
      violations.push(
        `  require('${spec}') at ${where(line)}${via} (require is invisible to the static graph — use a static import so the boundary sees it)`,
      )
      continue
    }
    if (spec.includes('?')) {
      // Query-suffixed imports (`?raw`, `?url`) inline the file as a string
      // or URL: they contribute no module to the graph, so they are neither
      // walked nor allowlisted. (The MDX content rides `?raw` for exactly
      // this reason — D-047.)
      continue
    }
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
    'move it behind dynamic import() (see CanvasHost.tsx) so it leaves the initial graph.',
  )
}

console.log(`ssr-boundary: ok (${visited.size} units reachable, initial graph is react-only)`)
