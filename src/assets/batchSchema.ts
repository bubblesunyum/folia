// The asset attribute contract (D-033): every primitive headed into a batch
// carries exactly its batch's attributes, custom ones in one fixed storage
// each, and the quantized built-ins match across the batch. The pack step fails
// the export on any violation; nothing here touches three, so it runs in Node too.

/** glTF accessor componentTypes. */
export const FLOAT = 5126
export const UNSIGNED_BYTE = 5121
export const UNSIGNED_SHORT = 5123

export interface CustomStorage {
  componentType: number
  normalized: boolean
  /** Stored values are `value / range`; loading multiplies back. */
  range: number
}

/**
 * How each custom attribute is packed. Fixed per attribute rather than chosen
 * from the values (the trap D-033 names), and dequantized to Float32 at load.
 * `_NIGHT` spill brighter than `range` clips.
 */
export const customStorage: Readonly<Record<string, CustomStorage>> = {
  _ID: { componentType: UNSIGNED_BYTE, normalized: false, range: 1 },
  _AO: { componentType: UNSIGNED_BYTE, normalized: true, range: 1 },
  _NIGHT: { componentType: UNSIGNED_SHORT, normalized: true, range: 4 },
}

/**
 * `source` (Float32, `size` components per vertex) in `storage`. Normalized
 * vectors brighter than the range are scaled down whole, so over-bright spill
 * keeps its hue; unnormalized values (ids) are stored as-is and must fit.
 */
export function packValues(
  source: Float32Array,
  size: number,
  storage: CustomStorage,
): Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> {
  const max = storage.componentType === UNSIGNED_BYTE ? 255 : 65535
  const packed =
    storage.componentType === UNSIGNED_BYTE
      ? new Uint8Array(source.length)
      : new Uint16Array(source.length)
  for (let i = 0; i < source.length; i += size) {
    const element = source.subarray(i, i + size)
    const over = storage.normalized ? Math.max(1, Math.max(...element) / storage.range) : 1
    for (let c = 0; c < size; c++) {
      const value = Math.max((element[c] ?? 0) / storage.range / over, 0)
      if (!storage.normalized && Math.round(value) > max) {
        throw new Error(`value ${element[c]} doesn't fit its ${max}-max storage`)
      }
      packed[i + c] = Math.round(storage.normalized ? Math.min(value, 1) * max : value)
    }
  }
  return packed
}

/** Semantic → item size. Custom attributes are `_`-prefixed (D-034). */
export type BatchSchema = Readonly<Record<string, number>>

const BAKED: BatchSchema = { POSITION: 3, NORMAL: 3, _ID: 1, _AO: 1, _NIGHT: 3 }

/** One schema per shared-material batch. Neon is its own program and bakes nothing. */
export const batchSchemas: Readonly<Record<string, BatchSchema>> = {
  cream: BAKED,
  gold: BAKED,
  ground: BAKED,
  foliage: BAKED,
  neon: { POSITION: 3, NORMAL: 3, _ID: 1 },
}

export interface AttributeInfo {
  itemSize: number
  componentType: number
  normalized: boolean
}

export interface PrimitiveAttributes {
  /** Where the primitive came from, for error messages. */
  name: string
  attributes: Readonly<Record<string, AttributeInfo>>
}

/**
 * Every way `primitives` break `batch`'s schema; empty when they don't.
 * `stage` is 'raw' (Blender's Float32 export) or 'packed' (custom attributes
 * in their `customStorage`).
 */
export function validateBatch(
  batch: string,
  primitives: readonly PrimitiveAttributes[],
  stage: 'raw' | 'packed',
  schemas: Readonly<Record<string, BatchSchema>> = batchSchemas,
): string[] {
  const schema = schemas[batch]
  if (!schema) return [`${batch}: no batch schema by that name`]

  const errors: string[] = []
  const first = primitives[0]
  for (const prim of primitives) {
    const where = `${batch}/${prim.name}`
    for (const semantic of Object.keys(schema)) {
      if (!(semantic in prim.attributes)) errors.push(`${where}: missing ${semantic}`)
    }
    for (const [semantic, info] of Object.entries(prim.attributes)) {
      const size = schema[semantic]
      if (size === undefined) {
        errors.push(`${where}: ${semantic} is not in the schema`)
        continue
      }
      if (info.itemSize !== size) {
        errors.push(`${where}: ${semantic} has ${info.itemSize} components, schema says ${size}`)
      }
      if (semantic.startsWith('_')) {
        const want =
          stage === 'raw'
            ? { componentType: FLOAT, normalized: false }
            : (customStorage[semantic] ?? { componentType: -1, normalized: false })
        if (info.componentType !== want.componentType || info.normalized !== want.normalized) {
          errors.push(`${where}: ${semantic} isn't stored as its ${stage} storage`)
        }
      }
      const reference = first?.attributes[semantic]
      if (
        reference &&
        prim !== first &&
        (reference.componentType !== info.componentType || reference.normalized !== info.normalized)
      ) {
        errors.push(`${where}: ${semantic} storage differs from ${first.name}`)
      }
    }
  }
  return errors
}

export interface MeshName {
  hood: string
  object: string
  material: string
  lod: string
}

const MESH_NAME = /^([a-z0-9-]+)\.([a-z0-9-]+)\.([a-z0-9-]+)\.([a-z0-9-]+)$/

/** Parses `<hood>.<object>.<material>.<lod>` (D-034); null when it doesn't fit. */
export function parseMeshName(name: string): MeshName | null {
  const match = MESH_NAME.exec(name)
  if (!match) return null
  const [, hood = '', object = '', material = '', lod = ''] = match
  return { hood, object, material, lod }
}
