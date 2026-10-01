import { describe, expect, it } from 'vitest'
import {
  type AttributeInfo,
  batchSchemas,
  customStorage,
  FLOAT,
  packValues,
  parseMeshName,
  UNSIGNED_BYTE,
  UNSIGNED_SHORT,
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

const u8id = (itemSize: number): AttributeInfo => ({
  itemSize,
  componentType: UNSIGNED_BYTE,
  normalized: false,
})

const u16n = (itemSize: number): AttributeInfo => ({
  itemSize,
  componentType: UNSIGNED_SHORT,
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

describe('_SWAY in the shared schemas (fol-qwq)', () => {
  const rawFoliage = {
    POSITION: f32(3),
    NORMAL: f32(3),
    _ID: f32(1),
    _AO: f32(1),
    _NIGHT: f32(3),
    _SWAY: f32(1),
  }
  const packedFoliage = {
    POSITION: i16(3),
    NORMAL: i16(3),
    _ID: u8id(1),
    _AO: u8n(1),
    _NIGHT: u16n(3),
    _SWAY: u8n(1),
  }

  it('stores _SWAY as normalized u8', () => {
    expect(customStorage._SWAY).toEqual({
      componentType: UNSIGNED_BYTE,
      normalized: true,
      range: 1,
    })
    expect(batchSchemas.foliage?._SWAY).toBe(1)
    expect(batchSchemas.cream?._SWAY).toBeUndefined()
  })

  it('requires the weight on foliage and forbids it elsewhere', () => {
    expect(validateBatch('foliage', [{ name: 'a', attributes: rawFoliage }], 'raw')).toEqual([])
    expect(validateBatch('foliage', [{ name: 'a', attributes: packedFoliage }], 'packed')).toEqual(
      [],
    )
    const { _SWAY: _, ...missing } = rawFoliage
    expect(validateBatch('foliage', [{ name: 'a', attributes: missing }], 'raw')).toEqual([
      'foliage/a: missing _SWAY',
    ])
    expect(
      validateBatch('cream', [{ name: 'a', attributes: { ...packedFoliage } }], 'packed'),
    ).toContain('cream/a: _SWAY is not in the schema')
  })

  it('rejects a _SWAY stored any other way than its fixed storage', () => {
    expect(validateBatch('foliage', [{ name: 'a', attributes: packedFoliage }], 'raw')).toContain(
      "foliage/a: _SWAY isn't stored as its raw storage",
    )
    const float = { ...packedFoliage, _SWAY: f32(1) }
    expect(validateBatch('foliage', [{ name: 'a', attributes: float }], 'packed')).toEqual([
      "foliage/a: _SWAY isn't stored as its packed storage",
    ])
  })

  it('carries a second swaying batch with no pack change: schema only', () => {
    const extended = { stone: { POSITION: 3, _SWAY: 1 } }
    const raw = { POSITION: f32(3), _SWAY: f32(1) }
    expect(validateBatch('stone', [{ name: 'a', attributes: raw }], 'raw', extended)).toEqual([])
    expect(
      validateBatch('stone', [{ name: 'a', attributes: { POSITION: f32(3) } }], 'raw', extended),
    ).toEqual(['stone/a: missing _SWAY'])
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
