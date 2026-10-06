// The D-072 LOD split (fol-l7d.2): derives each dual asset's `.mid` town
// read and `.high` hero stream from its packed full export, without touching
// the Blender pipeline.
//
//   node scripts/lib/split-lods.mjs [asset…]   split stale twins (all by default)
//
// An asset is dual when its params declare non-empty `mid_groups` plus
// `high_groups` (group names, covering every manifest group exactly once —
// anything else fails closed). Its packed `<asset>.glb` is the single
// source: the splitter partitions its triangles by `_ID` slot (every
// triangle's three vertices share one part, so faces are never cut),
// compacts each side's vertices by raw byte copy (quantization bit-exact,
// never re-quantized), renames meshes to `.mid`/`.high`, validates both
// against the batch schemas, and records per-LOD bytes/triangles in
// `assets/manifest.json` for `scripts/budget.mjs`.
//
// Single-LOD assets (`lod: "mid"` with no lists, e.g. the town skeleton)
// keep their `<asset>.glb` as-is and record it as their one side. The
// pipeline's full export stays committed as the canonical bake; the twins
// are delivery derivatives, like thumbnails. Deterministic: same input,
// same bytes (meshopt re-encodes the compacted buffers, in original order).
//
// Staleness is fail-closed, never silent: the record keeps the source bytes
// the twins were split from, and the budget fails when the committed full
// export moved on (rebuild, then re-run this). Wire-up into the pipeline
// and the dev watcher belongs to the pipeline owner, not this tool.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { batchSchemas, parseMeshName, validateBatch } from '../../src/assets/batchSchema.ts'

const ROOT = new URL('../..', import.meta.url).pathname
const MANIFEST_PATH = join(ROOT, 'assets/manifest.json')
const PARAMS = (asset) => join(ROOT, 'assets/blender', `${asset}.json`)
const FULL = (asset) => join(ROOT, 'public/assets', `${asset}.glb`)
const TWIN = (asset, lod) => join(ROOT, 'public/assets', `${asset}.${lod}.glb`)

const fail = (message) => {
  throw new Error(`split-lods: ${message}`)
}

async function io() {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
}

/** Every triangle's `_ID` group, asserting faces are never cut across parts. */
function triangleGroups(indexArray, idArray) {
  const groups = new Array(indexArray.length / 3)
  for (let t = 0; t < groups.length; t++) {
    const a = idArray[indexArray[t * 3]]
    const b = idArray[indexArray[t * 3 + 1]]
    const c = idArray[indexArray[t * 3 + 2]]
    if (a === undefined || b === undefined || c === undefined) {
      fail(`triangle ${t} indexes a missing vertex`)
    }
    if (a !== b || b !== c) fail(`triangle ${t} spans _ID groups (${a}, ${b}, ${c})`)
    groups[t] = a
  }
  return groups
}

/** Attribute arrays compacted to `used` vertices, raw bytes preserved. */
function compactAttribute(doc, oldAccessor, used, map) {
  const elementSize = oldAccessor.getElementSize()
  const oldArray = oldAccessor.getArray()
  if (!oldArray) fail('attribute has no array')
  const fresh = new oldArray.constructor(used.length * elementSize)
  used.forEach((old, nu) => {
    for (let c = 0; c < elementSize; c++) fresh[nu * elementSize + c] = oldArray[old * elementSize + c]
    map.set(old, nu)
  })
  const accessor = doc.createAccessor()
  accessor.setType(oldAccessor.getType())
  accessor.setArray(fresh)
  accessor.setNormalized(oldAccessor.getNormalized())
  for (const name of oldAccessor.listExtensions()) {
    const prop = oldAccessor.getExtension(name)
    if (prop) accessor.setExtension(name, prop.clone())
  }
  return accessor
}

/**
 * Rewrites every primitive in `doc` to its `keep` triangles (global `_ID`
 * slots in `slots`), compacting vertices. Returns per-batch triangles plus
 * vertex/index counts for the manifest. Primitives left empty are detached
 * and disposed with their accessors; replaced accessors are disposed too —
 * the writer emits every accessor left in the graph, so anything untracked
 * ships its bytes.
 */
function filterDocument(doc, slots, counts) {
  let liveAccessors = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = parseMeshName(mesh.getName())
    if (!name) fail(`mesh "${mesh.getName()}" is not <hood>.<object>.<material>.<lod>`)
    const kept = []
    for (const prim of mesh.listPrimitives()) {
      const indexAccessor = prim.getIndices()
      const idAccessor = prim.getAttribute('_ID')
      if (!indexAccessor || !idAccessor) fail(`${mesh.getName()}: primitive has no index or _ID`)
      const indexArray = Array.from(indexAccessor.getArray() ?? [])
      const idArray = Array.from(idAccessor.getArray() ?? [])
      const groups = triangleGroups(indexArray, idArray)
      const tris = []
      for (let t = 0; t < groups.length; t++) {
        if (slots.has(groups[t])) tris.push(t)
      }
      if (tris.length === 0) {
        for (const semantic of prim.listSemantics()) prim.getAttribute(semantic)?.dispose()
        indexAccessor.dispose()
        mesh.removePrimitive(prim)
        prim.dispose()
        continue
      }
      const usedSet = new Set()
      for (const t of tris) {
        usedSet.add(indexArray[t * 3])
        usedSet.add(indexArray[t * 3 + 1])
        usedSet.add(indexArray[t * 3 + 2])
      }
      const used = [...usedSet].sort((a, b) => a - b)
      const map = new Map()
      const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
      for (const semantic of prim.listSemantics()) {
        const old = prim.getAttribute(semantic)
        const fresh = compactAttribute(doc, old, used, map)
        fresh.setBuffer(buffer)
        prim.setAttribute(semantic, fresh)
        old?.dispose()
      }
      const freshIndex = new Uint32Array(tris.length * 3)
      tris.forEach((t, i) => {
        freshIndex[i * 3] = map.get(indexArray[t * 3])
        freshIndex[i * 3 + 1] = map.get(indexArray[t * 3 + 1])
        freshIndex[i * 3 + 2] = map.get(indexArray[t * 3 + 2])
      })
      // Keep the original index width when the compacted vertices fit, so a
      // u16 batch stays u16 instead of doubling.
      const narrowed =
        used.length <= 65535 && indexAccessor.getComponentType() !== 5125
          ? Uint16Array.from(freshIndex)
          : freshIndex
      const index = doc.createAccessor()
      index.setType('SCALAR')
      index.setArray(narrowed)
      index.setBuffer(buffer)
      prim.setIndices(index)
      indexAccessor.dispose()
      liveAccessors += prim.listSemantics().length + 1
      kept.push({ prim, tris: tris.length, vertices: used.length, indices: narrowed.length })
    }
    if (kept.length === 0) {
      for (const node of doc.getRoot().listNodes()) {
        if (node.getMesh() === mesh) node.setMesh(null)
      }
    }
    for (const { prim, tris, vertices, indices } of kept) {
      void prim
      const batch = counts[name.material] ?? (counts[name.material] = { tris: 0, vertices: 0, indices: 0 })
      batch.tris += tris
      batch.vertices += vertices
      batch.indices += indices
    }
  }
  // Fail closed on orphan accessors: the writer emits every accessor left in
  // the graph, so an untracked one ships dead bytes.
  const orphans = doc.getRoot().listAccessors().length - liveAccessors
  if (orphans !== 0) fail(`expected no orphan accessors, found ${orphans}`)
}

/** Every schema violation in `doc`, mirroring the pack validator's stage. */
function validateDocument(doc, stage) {
  const batches = new Map()
  const errors = []
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = parseMeshName(mesh.getName())
    if (!name) {
      errors.push(`${stage}: mesh "${mesh.getName()}" is not <hood>.<object>.<material>.<lod>`)
      continue
    }
    for (const [i, prim] of mesh.listPrimitives().entries()) {
      const attributes = Object.fromEntries(
        prim.listSemantics().map((semantic) => {
          const accessor = prim.getAttribute(semantic)
          return [
            semantic,
            {
              itemSize: accessor?.getElementSize() ?? 0,
              componentType: accessor?.getComponentType() ?? 0,
              normalized: accessor?.getNormalized() ?? false,
            },
          ]
        }),
      )
      const list = batches.get(name.material) ?? []
      list.push({ name: `${mesh.getName()}#${i}`, attributes })
      batches.set(name.material, list)
    }
  }
  for (const [batch, prims] of batches) {
    errors.push(...validateBatch(batch, prims, 'packed', batchSchemas).map((e) => `${stage}: ${e}`))
  }
  return errors
}

/** Atomic publish: the dev server serves this path live. */
function writeAtomic(path, data) {
  const tmp = join(tmpdir(), `folia-split-${process.pid}-${Math.random().toString(36).slice(2)}`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function sumSides(lods) {
  const out = {}
  for (const side of Object.values(lods)) {
    for (const [batch, tris] of Object.entries(side.triangles)) {
      out[batch] = (out[batch] ?? 0) + tris
    }
  }
  return out
}

export async function splitAsset(asset, manifest) {
  const record = manifest[asset]
  if (!record) fail(`no manifest record for "${asset}"`)
  const params = JSON.parse(readFileSync(PARAMS(asset), 'utf8'))
  const midGroups = params.mid_groups
  const highGroups = params.high_groups
  const fullBytes = existsSync(FULL(asset)) ? readFileSync(FULL(asset)).length : -1
  if (fullBytes < 0) fail(`${asset}.glb missing from public/assets`)

  const dual = midGroups !== undefined || highGroups !== undefined
  if (dual) {
    if (!Array.isArray(midGroups) || !Array.isArray(highGroups) || highGroups.length === 0) {
      fail(`${asset}: mid_groups and non-empty high_groups are both required for a split`)
    }
    const slots = record.groups ?? {}
    const midSlots = new Set(midGroups.map((g) => slots[g]))
    const highSlots = new Set(highGroups.map((g) => slots[g]))
    for (const g of [...midGroups, ...highGroups]) {
      if (slots[g] === undefined) fail(`${asset}: group "${g}" has no manifest slot`)
    }
    const overlap = [...midSlots].filter((s) => highSlots.has(s))
    if (overlap.length) fail(`${asset}: groups share slots ${overlap}`)
    const covered = new Set([...midSlots, ...highSlots])
    const missing = Object.values(slots).filter((s) => !covered.has(s))
    if (missing.length) fail(`${asset}: slots ${missing} are in neither mid nor high groups`)
    if (covered.size !== Object.keys(slots).length) fail(`${asset}: group lists don't cover every slot`)

    const nodeIO = await io()
    const lods = {}
    for (const [lod, keep] of [['mid', midSlots], ['high', highSlots]]) {
      const doc = await nodeIO.read(FULL(asset))
      const counts = {}
      filterDocument(doc, keep, counts)
      for (const mesh of doc.getRoot().listMeshes()) {
        const name = parseMeshName(mesh.getName())
        mesh.setName(`${name.hood}.${name.object}.${name.material}.${lod}`)
      }
      for (const scene of doc.getRoot().listScenes()) {
        const extras = scene.getExtras()
        scene.setExtras({ ...extras, lod })
      }
      const errors = validateDocument(doc, `split-${lod}`)
      if (errors.length) fail(`${asset}.${lod}:\n${errors.join('\n')}`)
      const glb = await nodeIO.writeBinary(doc)
      writeAtomic(TWIN(asset, lod), glb)
      lods[lod] = {
        file: `${asset}.${lod}`,
        bytes: glb.byteLength,
        triangles: Object.fromEntries(Object.entries(counts).map(([b, c]) => [b, c.tris])),
        vertices: Object.fromEntries(Object.entries(counts).map(([b, c]) => [b, c.vertices])),
        indices: Object.fromEntries(Object.entries(counts).map(([b, c]) => [b, c.indices])),
      }
    }
    // Lossless partition proof: both sides sum back to the full export.
    for (const [batch, total] of Object.entries(record.triangles)) {
      const part = (lods.mid.triangles[batch] ?? 0) + (lods.high.triangles[batch] ?? 0)
      if (part !== total) fail(`${asset}: ${batch} split to ${part} tris, full has ${total}`)
    }
    for (const [key, total] of [['vertices', record.vertices], ['indices', record.indices]]) {
      for (const [batch, n] of Object.entries(total ?? {})) {
        const part = (lods.mid[key][batch] ?? 0) + (lods.high[key][batch] ?? 0)
        if (part !== n) fail(`${asset}: ${batch} split to ${part} ${key}, full has ${n}`)
      }
    }
    const triangles = sumSides(lods)
    const bytes = lods.mid.bytes + lods.high.bytes
    return { ...record, bytes, triangles, lods, sourceBytes: fullBytes }
  }

  // Single-LOD: the full export is the side its params `lod` declares.
  const side = params.lod === 'mid' ? 'mid' : 'high'
  for (const twin of ['mid', 'high']) {
    if (existsSync(TWIN(asset, twin))) fail(`${asset}: single-${side} but stale ${twin} twin exists`)
  }
  return {
    ...record,
    lods: { [side]: { file: asset, bytes: fullBytes, triangles: { ...record.triangles } } },
    sourceBytes: fullBytes,
  }
}

function writeManifest(manifest) {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
}

if (import.meta.main) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const named = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const assets = named.length ? named : Object.keys(manifest)
  let changed = false
  for (const asset of assets) {
    const record = await splitAsset(asset, manifest)
    manifest[asset] = record
    changed = true
    const lods = Object.entries(record.lods)
      .map(([lod, s]) => `${lod} ${(s.bytes / 1e6).toFixed(2)} MB`)
      .join(' + ')
    console.log(`${asset}: ${lods}`)
  }
  if (changed) writeManifest(manifest)
}
