// The custom gltf-transform step (R-009, D-033): validate the raw Blender
// export against the batch schemas, pack custom attributes into their fixed
// storage, quantize POSITION and NORMAL, compress with Meshopt, validate again,
// write. It deliberately doesn't use `meshopt()`: at level 'medium' that
// quantizes any attribute that happens to fall in [-1, 1], which would store
// `_AO` as Uint16 in one asset and Float32 in the next depending on its values.

import { type Document, Logger, NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { quantize, reorder } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import {
  customStorage,
  type PrimitiveAttributes,
  packValues,
  parseMeshName,
  validateBatch,
} from '../../src/assets/batchSchema.ts'
import { writeFileAtomic } from './atomic.ts'

// 16-bit positions because a batch spans a whole placed neighborhood; normals
// at 10 bits so glossy cream and gold don't band (D-033).
const QUANTIZE = {
  pattern: /^(POSITION|NORMAL)$/,
  quantizePosition: 16,
  quantizeNormal: 10,
  quantizationVolume: 'mesh',
} as const

async function io(): Promise<NodeIO> {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
}

/** Every schema violation in `doc`, grouped by batch, each prefixed with `stage`. */
export function validateDocument(doc: Document, stage: 'raw' | 'packed'): string[] {
  const batches = new Map<string, PrimitiveAttributes[]>()
  const errors: string[] = []
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
    errors.push(...validateBatch(batch, prims, stage).map((e) => `${stage}: ${e}`))
  }
  return errors
}

/** Rewrites every custom attribute into its `customStorage` (see `packValues`). */
function packCustomAttributes(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        const storage = customStorage[semantic]
        const accessor = prim.getAttribute(semantic)
        const source = accessor?.getArray()
        if (!storage || !accessor || !(source instanceof Float32Array)) continue
        const packed = packValues(source, accessor.getElementSize(), storage)
        accessor.setArray(packed).setNormalized(storage.normalized)
      }
    }
  }
}

/** Rewrites every `_ID` value through `idRemap`; throws on an unmapped id. */
function remapIds(doc: Document, idRemap: ReadonlyMap<number, number>): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const source = prim.getAttribute('_ID')?.getArray()
      if (!(source instanceof Float32Array)) continue
      for (let i = 0; i < source.length; i++) {
        const slot = idRemap.get(source[i] ?? NaN)
        if (slot === undefined) throw new Error(`local _ID ${source[i]} has no global slot`)
        source[i] = slot
      }
    }
  }
}

/** Packs `rawPath` into `outPath`, remapping local `_ID`s to global slots first; throws with every violation if the contract breaks. */
export async function pack(
  rawPath: string,
  outPath: string,
  idRemap: ReadonlyMap<number, number>,
): Promise<{ bytes: number }> {
  const nodeIO = await io()
  const doc = await nodeIO.read(rawPath)
  // Global slots (D-061): Blender bakes per-asset local `_ID`s; remap to the
  // town-wide slots first, so a second asset reusing 0..N can't collide once
  // two assets share a batch (fol-716). Required, never skipped: an unmapped
  // pack would validate fine and collide silently.
  remapIds(doc, idRemap)
  const before = validateDocument(doc, 'raw')
  if (before.length) throw new Error(before.join('\n'))

  packCustomAttributes(doc)
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize(QUANTIZE))
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

  const after = validateDocument(doc, 'packed')
  if (after.length) throw new Error(after.join('\n'))

  const glb = await nodeIO.writeBinary(doc)
  // Atomic publish: the dev server serves this path live, so a concurrent
  // CLI build must never leave a half-written GLB behind (fol-4rq).
  await writeFileAtomic(outPath, glb)
  return { bytes: glb.byteLength }
}
