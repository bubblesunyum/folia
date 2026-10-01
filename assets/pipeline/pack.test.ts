// fol-a83 / fol-qwq: foliage carries the baked `_SWAY` sway weight (Blender
// bakes it, every other batch drops it at split) through the shared batch
// schemas and `customStorage`; `validateDocument` runs the generic check.
import { Document } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { customStorage, packValues } from '../../src/assets/batchSchema.ts'
import { validateDocument } from './pack'

type SwayInput = {
  array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>
  normalized: boolean
} | null

/** One mesh with a full foliage/cream attribute set, `_SWAY` iff `sway`. */
function docWithMesh(name: string, packed: boolean, sway: SwayInput): Document {
  const doc = new Document()
  const acc = (
    array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
    type: 'SCALAR' | 'VEC3',
    normalized = false,
  ) => doc.createAccessor().setArray(array).setType(type).setNormalized(normalized)
  const prim = doc.createPrimitive()
  prim.setAttribute('POSITION', acc(new Float32Array(3), 'VEC3'))
  prim.setAttribute('NORMAL', acc(new Float32Array(3), 'VEC3'))
  prim.setAttribute('_ID', acc(packed ? new Uint8Array(1) : new Float32Array(1), 'SCALAR'))
  prim.setAttribute('_AO', acc(packed ? new Uint8Array(1) : new Float32Array(1), 'SCALAR', packed))
  prim.setAttribute(
    '_NIGHT',
    acc(packed ? new Uint16Array(3) : new Float32Array(3), 'VEC3', packed),
  )
  if (sway) {
    prim.setAttribute('_SWAY', acc(sway.array, 'SCALAR', sway.normalized))
  }
  doc.createMesh(name).addPrimitive(prim)
  return doc
}

const FOLIAGE = 'cortico.fragment.foliage.lod'

describe('validateDocument with _SWAY', () => {
  it('accepts raw foliage carrying the baked weight', () => {
    const doc = docWithMesh(FOLIAGE, false, { array: new Float32Array([0.5]), normalized: false })
    expect(validateDocument(doc, 'raw')).toEqual([])
  })

  it('fails closed when the bake omits the weight', () => {
    const doc = docWithMesh(FOLIAGE, false, null)
    expect(validateDocument(doc, 'raw')).toEqual([`raw: foliage/${FOLIAGE}#0: missing _SWAY`])
  })

  it('accepts the packed weight as normalized u8', () => {
    const doc = docWithMesh(FOLIAGE, true, { array: new Uint8Array([128]), normalized: true })
    expect(validateDocument(doc, 'packed')).toEqual([])
  })

  it('rejects a packed weight left as float', () => {
    const doc = docWithMesh(FOLIAGE, true, { array: new Float32Array([0.5]), normalized: false })
    expect(validateDocument(doc, 'packed')).toEqual([
      `packed: foliage/${FOLIAGE}#0: _SWAY isn't stored as its packed storage`,
    ])
  })

  it('rejects the weight outside foliage: the split must drop it', () => {
    const doc = docWithMesh('cortico.fragment.cream.lod', false, {
      array: new Float32Array([0]),
      normalized: false,
    })
    expect(validateDocument(doc, 'raw')).toEqual([
      `raw: cream/cortico.fragment.cream.lod#0: _SWAY is not in the schema`,
    ])
  })

  it('round-trips weights through the u8 packing', () => {
    const sway = customStorage._SWAY
    if (!sway) throw new Error('storage missing')
    const weights = new Float32Array([0, 0.25, 0.5, 0.75, 1])
    const packed = packValues(weights, 1, sway)
    for (const [i, w] of [...weights].entries()) {
      expect((packed[i] ?? 0) / 255).toBeCloseTo(w, 2)
    }
  })
})
