// Look-dev write-back (fol-qbb, D-034): the panel POSTs its working copy to
// the dev server, which validates it and writes `palette.ts` /
// `keyframes.json` back to disk. File names are fixed (never paths), and the
// writes are atomic; the client reloads after a save to prove the scene
// matches disk. Dev-only: the middleware lives in `configureServer`.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { palette } from '../../src/palette.ts'
import { loadKeyframes } from '../../src/time/look.ts'
import { writeFileAtomic } from './atomic.ts'

const ROOT = resolve(import.meta.dirname, '../..')

export type LookFile = 'palette' | 'keyframes'

function lookFilePath(file: LookFile, root: string): string {
  return file === 'palette' ? join(root, 'src/palette.ts') : join(root, 'src/time/keyframes.json')
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * `source` (palette.ts text) with every entry set to `pal`. Entries are
 * replaced in place, so comments and grouping survive; unknown names, bad
 * hex and missing entries throw instead of writing a half-regenerated file.
 */
export function renderPaletteTs(source: string, pal: Record<string, string>): string {
  let out = source
  for (const [name, hex] of Object.entries(pal)) {
    if (!(name in palette)) throw new Error(`unknown palette color ${JSON.stringify(name)}`)
    if (!HEX.test(hex)) throw new Error(`palette ${name} isn't a hex color: ${JSON.stringify(hex)}`)
    const pattern = new RegExp(`^([ \\t]*${name}:[ \\t]*)'#[0-9a-fA-F]{6}'`, 'm')
    if (!pattern.test(out)) throw new Error(`palette.ts has no ${name} entry; refusing to add one`)
    out = out.replace(pattern, `$1'${hex}'`)
  }
  return out
}

/**
 * Validated keyframes file text. `loadKeyframes` resolves every color name
 * through the palette, so a typo fails the save instead of the next reload.
 * (Field types are trusted to the panel's typed controls.) Triples collapse
 * back onto one line, so a save byte-matches biome's JSON format instead of
 * churning every array it touches.
 */
export function renderKeyframesJson(keyframes: unknown): string {
  if (!Array.isArray(keyframes)) throw new Error('keyframes data must be an array')
  loadKeyframes({ keyframes })
  return `${compactTriples(JSON.stringify({ keyframes }, null, 2))}\n`
}

/** Collapses pure-number triples (`[\n 1,\n 1,\n 1\n]` → `[1, 1, 1]`). */
function compactTriples(text: string): string {
  return text.replace(/\[\s+(-?[\d.e]+),\s+(-?[\d.e]+),\s+(-?[\d.e]+)\s+\]/g, '[$1, $2, $3]')
}

export interface LookRequest {
  file: LookFile
  data: unknown
}

/** Shape-checks a POST body; the file is a fixed name, never a path. */
export function parseLookRequest(body: unknown): LookRequest {
  const record = (body ?? {}) as Record<string, unknown>
  if (record.file !== 'palette' && record.file !== 'keyframes') {
    throw new Error('request needs { file: "palette" | "keyframes", data }')
  }
  if (record.data === undefined) throw new Error('request needs a data field')
  return { file: record.file, data: record.data }
}

/** Validates `data` and writes it to `file` under `root` (the repo by default). */
export async function writeLookFile(
  file: LookFile,
  data: unknown,
  root: string = ROOT,
): Promise<void> {
  if (file === 'palette') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('palette data must be an object')
    }
    const path = lookFilePath(file, root)
    await writeFileAtomic(
      path,
      renderPaletteTs(readFileSync(path, 'utf8'), data as Record<string, string>),
    )
  } else {
    await writeFileAtomic(lookFilePath(file, root), renderKeyframesJson(data))
  }
}
