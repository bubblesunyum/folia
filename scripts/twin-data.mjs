// Trailing-slash .data twins (fol-e6h): React Router's single-fetch maps a
// trailing-slash pathname `/x/` to `/x/_.data`, but the prerender only emits
// the slashless `/x.data`. Entries gain trailing slashes in the wild (vite
// preview directory-redirects `/cortico` to `/cortico/`, users type and share
// slashed links), so a pop or Back restoring one fetches HTML fallback and
// fails the whole outlet on turbo-stream decode. Static hosts serve files, so
// emit the twins at build: byte-identical copies, fail closed when missing.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CLIENT = join('build', 'client')

// Derived by globbing: every prerendered `.data` file gets its trailing-slash
// twin, so a newly added case is covered without editing this script. Root
// `/` already emits `_.data` itself, and files already ending in `_.data`
// are skipped.
function collectTwins(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTwins(abs, out)
    } else if (entry.name.endsWith('.data') && !entry.name.endsWith('_.data')) {
      const rel = abs.slice(CLIENT.length + 1, -'.data'.length)
      out.push([abs, join(CLIENT, rel, '_.data')])
    }
  }
  return out
}

const TWINS = collectTwins(CLIENT)

let failed = false
if (TWINS.length === 0) {
  console.error('twin-data: failed: no .data files under build/client — run react-router build first')
  failed = true
}
for (const [src, dst] of TWINS) {
  if (!existsSync(src)) {
    console.error(`twin-data: failed: missing prerender output ${src} — run react-router build first`)
    failed = true
    continue
  }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  console.log(`twin-data: ${dst.slice(CLIENT.length + 1)} (twin)`)
}
if (failed) process.exit(1)
