// Builds Blender assets into packed GLBs, skipping any whose sources haven't
// changed (D-034's per-asset content hash).
//
//   node assets/pipeline/build.ts [asset…] [--force] [--json]   build stale assets (all by default)
//   node assets/pipeline/build.ts --check               fail if any committed GLB is stale or an LFS pointer
//
// An asset is `assets/blender/<hood>/<object>.py` plus its `.json` params. The
// packed GLB lands in `public/assets/<hood>/<object>.glb`, and its source hash
// in `assets/manifest.json`, which is what `--check` compares against.

import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { parseMeshName } from '../../src/assets/batchSchema.ts'
import { palette } from '../../src/palette.ts'
import { withFileLock, writeFileAtomic } from './atomic.ts'
import { allocateSlots, assetLocalIds, type GroupRegistry, type GroupTable } from './groups.ts'
import { isLfsPointer } from './lfs.ts'
import { pack } from './pack.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const BLENDER_DIR = join(ROOT, 'assets/blender')
const MANIFEST = join(ROOT, 'assets/manifest.json')
// Gitignored, shared by every concurrent builder on this machine (fol-4rq).
const MANIFEST_LOCK = join(ROOT, '.cache', 'manifest.lock')
const BLENDER = process.env.FOLIA_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'

export interface AssetRecord {
  hash: string
  bytes: number
  triangles: Record<string, number>
  /** Per-batch packed vertex counts, sizing the town batches (fol-3w2). */
  vertices: Record<string, number>
  /** Per-batch packed index counts, sizing the town batches (fol-3w2). */
  indices: Record<string, number>
  /** Group name → global `uGroupState` slot (D-061). */
  groups: GroupTable
}

export interface BuildResult extends AssetRecord {
  asset: string
  seconds: Record<string, number>
}

type Manifest = Record<string, AssetRecord>

/** Every `<hood>/<object>` with both a script and a params file. */
export function listAssets(): string[] {
  return readdirSync(BLENDER_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'folia' && !d.name.startsWith('_'))
    .flatMap((d) =>
      readdirSync(join(BLENDER_DIR, d.name))
        .filter(
          (f) =>
            f.endsWith('.json') &&
            existsSync(join(BLENDER_DIR, d.name, f.replace(/\.json$/, '.py'))),
        )
        .map((f) => `${d.name}/${f.replace(/\.json$/, '')}`),
    )
    .sort()
}

/** The files an asset's output depends on, absolute and sorted.
 *
 * `src/palette.ts` stays listed so the dev watcher wakes on palette saves,
 * but `hashAsset` hashes only the bake-relevant entries (`bakePalette`),
 * not the file bytes — a sky-color tweak must not re-run Blender.
 * `src/materials/features.ts` is deliberately absent: shader code never
 * reaches the bake. The slot limit lives in `src/groupSlots.ts`, which is
 * listed: shrinking it can invalidate packed `_ID`s, so a change must
 * re-validate (and fail closed in `allocateSlots`) rather than pass `--check`.
 * The shared sway retune point `folia/foliage_params.json` is listed
 * explicitly (it is not `*.py`, so the shared glob misses it): a retune must
 * change `hashAsset` and wake the dev watcher, not ship stale geometry.
 */
export function assetSources(asset: string): string[] {
  const sharedPy = readdirSync(join(BLENDER_DIR, 'folia'))
    .filter((f) => f.endsWith('.py'))
    .map((f) => join(BLENDER_DIR, 'folia', f))
  const shared = [...sharedPy, join(BLENDER_DIR, 'folia', 'foliage_params.json')]
  return [
    ...shared,
    join(BLENDER_DIR, 'build.py'),
    join(BLENDER_DIR, 'VERSION'),
    join(BLENDER_DIR, `${asset}.py`),
    join(BLENDER_DIR, `${asset}.json`),
    join(ROOT, 'src/palette.ts'),
    join(ROOT, 'src/groupSlots.ts'),
    join(ROOT, 'src/assets/batchSchema.ts'),
    join(ROOT, 'assets/pipeline/pack.ts'),
    join(ROOT, 'assets/pipeline/groups.ts'),
  ].sort()
}

/**
 * The palette entries the Blender bake reads (`assets/blender/build.py` uses
 * only `mint`, for the neon material). Everything hashed and passed to
 * Blender about color goes through here, so adding a second entry is one
 * line in both places.
 */
export function bakePalette(): { mint: string } {
  return { mint: palette.mint }
}

const PALETTE_FILE = join(ROOT, 'src/palette.ts')

// The pack step's output depends on these as much as on its source.
const TOOLCHAIN = [
  '@gltf-transform/core',
  '@gltf-transform/extensions',
  '@gltf-transform/functions',
  'meshoptimizer',
]

function toolchainVersions(): string {
  return TOOLCHAIN.map((name) => {
    const manifest = join(ROOT, 'node_modules', name, 'package.json')
    return `${name}@${JSON.parse(readFileSync(manifest, 'utf8')).version}`
  }).join(' ')
}

export function hashAsset(asset: string): string {
  const hash = createHash('sha256').update(toolchainVersions()).update('\0')
  for (const file of assetSources(asset)) {
    if (file === PALETTE_FILE) {
      hash.update('palette:').update(JSON.stringify(bakePalette())).update('\0')
    } else {
      hash.update(relative(ROOT, file)).update('\0').update(readFileSync(file)).update('\0')
    }
  }
  return hash.digest('hex').slice(0, 16)
}

export function outputPath(asset: string): string {
  return join(ROOT, 'public/assets', `${asset}.glb`)
}

function readManifest(): Manifest {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  await writeFileAtomic(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Assets whose committed GLB no longer matches their sources. */
export function staleAssets(): string[] {
  const manifest = readManifest()
  return listAssets().filter(
    (a) =>
      manifest[a]?.hash !== hashAsset(a) ||
      manifest[a]?.groups == null ||
      manifest[a]?.vertices == null ||
      manifest[a]?.indices == null ||
      !existsSync(outputPath(a)),
  )
}

/**
 * Per-batch vertex and index counts in the packed `glbPath` (fol-3w2):
 * POSITION accessor counts and index counts grouped by the material segment
 * of each `<hood>.<object>.<material>.<lod>` mesh name. Quantization and
 * Meshopt change storage, never counts, so these are what the town batches
 * size from. Non-indexed primitives contribute no index room: BatchedMesh
 * only advances its index cursor for geometries with an index.
 */
export async function countBatchGeometry(glbPath: string): Promise<{
  vertices: Record<string, number>
  indices: Record<string, number>
}> {
  await MeshoptDecoder.ready
  const nodeIO = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await nodeIO.read(glbPath)
  const vertices: Record<string, number> = {}
  const indices: Record<string, number> = {}
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = parseMeshName(mesh.getName())
    if (!name) throw new Error(`mesh "${mesh.getName()}" is not <hood>.<object>.<material>.<lod>`)
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      const index = prim.getIndices()
      vertices[name.material] = (vertices[name.material] ?? 0) + (position?.getCount() ?? 0)
      indices[name.material] = (indices[name.material] ?? 0) + (index?.getCount() ?? 0)
    }
  }
  return { vertices, indices }
}

/** Builds one asset; null when it was already fresh and `force` is off. */
export async function buildAsset(asset: string, force = false): Promise<BuildResult | null> {
  const hash = hashAsset(asset)
  const manifest = readManifest()
  if (
    !force &&
    manifest[asset]?.hash === hash &&
    manifest[asset]?.groups != null &&
    manifest[asset]?.vertices != null &&
    manifest[asset]?.indices != null &&
    existsSync(outputPath(asset))
  )
    return null

  const started = performance.now()
  // Per-invocation raw path: the dev plugin and a CLI build share nothing,
  // so concurrent Blender runs can't clobber each other's output (fol-4rq).
  const raw = join(
    ROOT,
    '.cache/blender',
    `${asset}.${process.pid}.${randomBytes(4).toString('hex')}.raw.glb`,
  )
  const args = [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    join(BLENDER_DIR, 'build.py'),
  ]
  let stdout: string
  try {
    ;({ stdout } = await promisify(execFile)(
      BLENDER,
      [...args, '--', asset, '--out', raw, '--palette', JSON.stringify(bakePalette())],
      {
        maxBuffer: 64 * 1024 * 1024,
      },
    ))
  } catch (error) {
    const out = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
    throw new Error(`blender failed on ${asset}:\n${out.split('\n').slice(-30).join('\n')}`)
  }
  const line = stdout.split('\n').find((l) => l.startsWith('FOLIA_BUILD '))
  if (!line) throw new Error(`blender printed no FOLIA_BUILD line for ${asset}`)
  const report = JSON.parse(line.slice('FOLIA_BUILD '.length)) as {
    triangles: Record<string, number>
    seconds: Record<string, number>
  }
  const blenderDone = performance.now()

  let bytes = 0
  let groups: GroupTable = {}
  let vertices: Record<string, number> = {}
  let indices: Record<string, number> = {}
  try {
    // Allocation, pack and record land in one lock hold: two concurrent
    // first-builds of different assets must not claim the same slot, and
    // the pack remap must match the recorded table (fol-4rq's lock,
    // fol-716's registry). Pack takes ~0.2 s; Blender already ran.
    await withFileLock(MANIFEST_LOCK, async () => {
      const live = readManifest()
      // Drop records for deleted assets so their slots return to the pool;
      // the current asset always survives (its params just read). Safe under
      // the lock: a concurrent build of a pruned asset reallocates and
      // rewrites its own record and GLB together.
      const known = new Set(listAssets())
      const kept = Object.fromEntries(Object.entries(live).filter(([a]) => known.has(a)))
      const registry: GroupRegistry = Object.fromEntries(
        Object.entries(kept).map(([a, r]) => [a, r.groups ?? {}]),
      )
      const allocated = allocateSlots(asset, assetLocalIds(asset), registry)
      groups = allocated.table
      ;({ bytes } = await pack(raw, outputPath(asset), allocated.remap))
      // Pack-time counts for the town batches (fol-3w2), read off the packed
      // GLB just published: quantization and Meshopt never change counts.
      ;({ vertices, indices } = await countBatchGeometry(outputPath(asset)))
      const record: AssetRecord = {
        hash,
        bytes,
        triangles: report.triangles,
        vertices,
        indices,
        groups,
      }
      await writeManifest({ ...kept, [asset]: record })
    })
  } finally {
    await rm(raw, { force: true })
  }

  const seconds = {
    ...report.seconds,
    blender: round((blenderDone - started) / 1000),
    pack: round((performance.now() - blenderDone) / 1000),
  }
  return { asset, hash, bytes, triangles: report.triangles, vertices, indices, groups, seconds }
}

const round = (s: number) => Math.round(s * 100) / 100

if (import.meta.main) {
  const argv = process.argv.slice(2)
  if (argv.includes('--check')) {
    const pointers = listAssets().filter(
      (a) => existsSync(outputPath(a)) && isLfsPointer(outputPath(a)),
    )
    if (pointers.length) {
      console.error(
        `GLBs are Git LFS pointers, not files (D-062): ${pointers.join(', ')}\n` +
          'install git-lfs, then run: git lfs install --local --skip-repo && git lfs pull',
      )
      process.exit(1)
    }
    const stale = staleAssets()
    if (stale.length) {
      console.error(`stale assets (run node assets/pipeline/build.ts): ${stale.join(', ')}`)
      process.exit(1)
    }
    console.log(`assets fresh (${listAssets().length})`)
  } else {
    const force = argv.includes('--force')
    // --json: one JSON line per asset, null when fresh (the dev plugin reads it).
    const json = argv.includes('--json')
    const named = argv.filter((a) => !a.startsWith('--'))
    for (const asset of named.length ? named : listAssets()) {
      const result = await buildAsset(asset, force)
      console.log(json || result ? JSON.stringify(result) : `${asset}: fresh`)
    }
  }
}
