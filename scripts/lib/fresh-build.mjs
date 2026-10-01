// Shared fail-closed fresh-build check (fol-sxw): budget.mjs and bench.mjs
// must both refuse to measure a missing or stale client build. One
// implementation — callers report the thrown message with their own prefix.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// React Router framework mode emits build/client (dist/ is pre-router output
// and must not be read).
export const CLIENT_INDEX = join('build/client', 'index.html')

const SOURCE_FILES = [
  'react-router.config.ts',
  'vite.config.ts',
  'package.json',
  join('assets/pipeline', 'vitePlugin.ts'),
  // The sway retune point (fol-6di): swayModel.ts imports it into the client
  // bundle, so a JSON-only retune must trip assertBuildFresh fail-closed.
  join('assets', 'blender', 'folia', 'foliage_params.json'),
]

export function newestSource() {
  let newest = { path: null, mtimeMs: -Infinity }
  const consider = (p) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) {
        if (/\.test\.tsx?$/.test(e)) continue // vitest-only, never in the client graph
        consider(join(p, e))
      }
    } else if (st.mtimeMs > newest.mtimeMs) {
      newest = { path: p, mtimeMs: st.mtimeMs }
    }
  }
  consider('src')
  for (const f of SOURCE_FILES) consider(f)
  return newest
}

// Throws when the build is missing or older than the sources that feed it.
export function assertBuildFresh(clientIndex = CLIENT_INDEX) {
  let buildStamp
  try {
    buildStamp = statSync(clientIndex).mtimeMs
  } catch {
    throw new Error(`no ${clientIndex} here — run the build first (the gate builds before this step)`)
  }
  const newest = newestSource()
  if (newest.path && newest.mtimeMs > buildStamp) {
    throw new Error(`build predates sources (${newest.path} is newer than ${clientIndex}) — rebuild first`)
  }
}
