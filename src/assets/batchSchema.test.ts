import { describe, expect, it } from 'vitest'
import {
  type AttributeInfo,
  customStorage,
  FLOAT,
  packValues,
  parseMeshName,
  UNSIGNED_BYTE,
  validateBatch,
} from './batchSchema'

const SHORT = 5122
const f32 = (itemSize: number): AttributeInfo => ({
  itemSize,
  componentType: FLOAT,
  normalized: false,
})
const i16 = (itemSize: number): AttributeInfo => ({
  itemSize,
  componentType: SHORT,
  normalized: true,
})

const u8n = (itemSize: number): AttributeInfo => ({
  itemSize,
  componentType: UNSIGNED_BYTE,
  normalized: true,
})

const schemas = { stone: { POSITION: 3, NORMAL: 3, _AO: 1 } }
const good = { POSITION: i16(3), NORMAL: i16(3), _AO: u8n(1) }

describe('validateBatch', () => {
  it('passes primitives that match the schema', () => {
    expect(validateBatch('stone', [{ name: 'a', attributes: good }], 'packed', schemas)).toEqual([])
    const raw = { ...good, _AO: f32(1) }
    expect(validateBatch('stone', [{ name: 'a', attributes: raw }], 'raw', schemas)).toEqual([])
  })

  it('reports missing and extra attributes', () => {
    const { _AO: _, ...missing } = good
    const errors = validateBatch(
      'stone',
      [{ name: 'a', attributes: { ...missing, COLOR_0: f32(4) } }],
      'packed',
      schemas,
    )
    expect(errors).toEqual(['stone/a: missing _AO', 'stone/a: COLOR_0 is not in the schema'])
  })

  it('rejects a custom attribute stored any other way than its fixed storage', () => {
    const raw = validateBatch('stone', [{ name: 'a', attributes: good }], 'raw', schemas)
    expect(raw).toEqual(["stone/a: _AO isn't stored as its raw storage"])
    const packed = { ...good, _AO: f32(1) }
    expect(validateBatch('stone', [{ name: 'a', attributes: packed }], 'packed', schemas)).toEqual([
      "stone/a: _AO isn't stored as its packed storage",
    ])
  })

  it('rejects built-ins stored differently across one batch', () => {
    const errors = validateBatch(
      'stone',
      [
        { name: 'a', attributes: good },
        { name: 'b', attributes: { ...good, NORMAL: f32(3) } },
      ],
      'packed',
      schemas,
    )
    expect(errors).toEqual(['stone/b: NORMAL storage differs from a'])
  })

  it('rejects a wrong item size and an unknown batch', () => {
    expect(
      validateBatch(
        'stone',
        [{ name: 'a', attributes: { ...good, _AO: u8n(3) } }],
        'packed',
        schemas,
      ),
    ).toEqual(['stone/a: _AO has 3 components, schema says 1'])
    expect(validateBatch('glass', [], 'packed', schemas)).toEqual([
      'glass: no batch schema by that name',
    ])
  })
})

describe('parseMeshName', () => {
  it('splits hood, object, material and lod', () => {
    expect(parseMeshName('cortico.fragment.cream.hi')).toEqual({
      hood: 'cortico',
      object: 'fragment',
      material: 'cream',
      lod: 'hi',
    })
  })

  it('refuses names off the convention', () => {
    expect(parseMeshName('cortico.cream.hi')).toBeNull()
    expect(parseMeshName('Cortico.fragment.cream.hi')).toBeNull()
  })
})

describe('packValues', () => {
  const night = customStorage._NIGHT
  const id = customStorage._ID
  if (!night || !id) throw new Error('storage missing')

  it('stores ids as-is, not rescaled', () => {
    expect([...packValues(new Float32Array([0, 1, 2, 3, 4]), 1, id)]).toEqual([0, 1, 2, 3, 4])
  })

  it('throws on an id that overflows its byte', () => {
    expect(() => packValues(new Float32Array([256]), 1, id)).toThrow()
  })

  it('scales an over-bright vector whole, keeping its hue', () => {
    const [r = 0, g = 0, b = 0] = packValues(new Float32Array([0.7, 9.9, 6.4]), 3, night)
    expect(g).toBe(65535)
    expect(b / g).toBeCloseTo(6.4 / 9.9, 3)
    expect(r / g).toBeCloseTo(0.7 / 9.9, 3)
  })

  it('leaves in-range vectors at their value', () => {
    const [r = 0] = packValues(new Float32Array([2, 0, 0]), 3, night)
    expect(r / 65535).toBeCloseTo(0.5, 4)
  })
})
