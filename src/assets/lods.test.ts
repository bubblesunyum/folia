// The D-072 split's gate logic, pinned without pixels (fol-l7d.2): each
// half fails on its own cap, the combined ceiling still binds, and the
// route rule keeps `/` on mid only.
import { describe, expect, it } from 'vitest'
import {
  type AssetManifest,
  checkLodBudgets,
  HIGH_BYTES,
  HIGH_TRIS,
  HOOD_BYTES,
  HOOD_TRIS,
  hoodLodTotals,
  hoodOf,
  lodStems,
  MID_BYTES,
  MID_TRIS,
  shouldStreamHigh,
} from './lods'

const RECORD = {
  hash: 'abc',
  groups: {},
  sourceBytes: 100,
}

function manifest(
  midBytes: number,
  midTris: number,
  highBytes: number,
  highTris: number,
): AssetManifest {
  return {
    'cortico/fragment': {
      ...RECORD,
      bytes: midBytes + highBytes,
      triangles: { cream: midTris + highTris },
      lods: {
        mid: { file: 'cortico/fragment.mid', bytes: midBytes, triangles: { cream: midTris } },
        high: { file: 'cortico/fragment.high', bytes: highBytes, triangles: { cream: highTris } },
      },
    },
  }
}

describe('hoodOf', () => {
  it('takes the hood segment', () => {
    expect(hoodOf('cortico/fragment')).toBe('cortico')
  })
})

describe('lodStems', () => {
  it('resolves both delivery files', () => {
    expect(lodStems('cortico/fragment', manifest(10, 5, 20, 8))).toEqual({
      mid: 'cortico/fragment.mid',
      high: 'cortico/fragment.high',
    })
  })

  it('resolves a single-mid asset with no high stream', () => {
    const records: AssetManifest = {
      'town/skeleton': {
        ...RECORD,
        bytes: 10,
        triangles: { ground: 5 },
        lods: { mid: { file: 'town/skeleton', bytes: 10, triangles: { ground: 5 } } },
      },
    }
    expect(lodStems('town/skeleton', records)).toEqual({ mid: 'town/skeleton', high: null })
  })

  it('fails closed on a missing record or an unstamped split', () => {
    expect(() => lodStems('cortico/missing', manifest(1, 1, 1, 1))).toThrow('no asset')
    expect(() =>
      lodStems('cortico/fragment', {
        'cortico/fragment': { ...RECORD, bytes: 2, triangles: { cream: 2 } },
      }),
    ).toThrow('no LOD split')
  })
})

describe('hoodLodTotals', () => {
  it('sums each half per hood', () => {
    expect(hoodLodTotals(manifest(10, 5, 20, 8)).cortico).toEqual({
      mid: { bytes: 10, tris: 5 },
      high: { bytes: 20, tris: 8 },
      all: { bytes: 30, tris: 13 },
    })
  })

  it('fails closed when the sides drift from the record', () => {
    const records = manifest(10, 5, 20, 8)
    const record = records['cortico/fragment']
    if (!record) throw new Error('test fixture is missing cortico/fragment')
    record.bytes = 31
    expect(() => hoodLodTotals(records)).toThrow('sum to 30 bytes but the record lists 31')
  })
})

describe('checkLodBudgets', () => {
  it('passes a split inside every cap', () => {
    expect(checkLodBudgets(manifest(100, 100, 200, 200))).toEqual([])
  })

  it('fails the mid half independently of high headroom', () => {
    const errors = checkLodBudgets(manifest(MID_BYTES + 1, 10, 10, 10))
    expect(errors).toEqual([`cortico mid bytes ${MID_BYTES + 1} over allowance ${MID_BYTES}`])
  })

  it('fails mid tris while mid bytes pass', () => {
    const errors = checkLodBudgets(manifest(10, MID_TRIS + 1, 10, 10))
    expect(errors).toEqual([`cortico mid tris ${MID_TRIS + 1} over allowance ${MID_TRIS}`])
  })

  it('fails the high half independently of mid headroom', () => {
    const errors = checkLodBudgets(manifest(10, 10, HIGH_BYTES + 1, HIGH_TRIS + 1))
    expect(errors).toEqual([
      `cortico high bytes ${HIGH_BYTES + 1} over allowance ${HIGH_BYTES}`,
      `cortico high tris ${HIGH_TRIS + 1} over allowance ${HIGH_TRIS}`,
    ])
  })

  it('fails the combined ceiling alongside the half that broke it', () => {
    // MID + HIGH == HOOD exactly, so a combined breach always rides with
    // the half that broke it — never alone, never hidden.
    const errors = checkLodBudgets(manifest(MID_BYTES, 10, HIGH_BYTES + 1, 10))
    expect(errors).toEqual([
      `cortico high bytes ${HIGH_BYTES + 1} over allowance ${HIGH_BYTES}`,
      `cortico combined bytes ${HOOD_BYTES + 1} over allowance ${HOOD_BYTES}`,
    ])
  })

  it('fails an unstamped record instead of judging it', () => {
    const errors = checkLodBudgets({
      'cortico/fragment': { ...RECORD, bytes: 2, triangles: { cream: 2 } },
    })
    expect(errors).toHaveLength(1)
    expect(errors.join('\n')).toMatch('no LOD split')
  })

  it('keeps the combined ceiling at 3 MB / 275k', () => {
    expect(HOOD_BYTES).toBe(3_000_000)
    expect(HOOD_TRIS).toBe(275_000)
  })
})

describe('shouldStreamHigh', () => {
  it('streams high at the hood vantage, mid only at /', () => {
    expect(shouldStreamHigh(undefined, 'cortico')).toBe(false)
    expect(shouldStreamHigh('cortico', 'cortico')).toBe(true)
    expect(shouldStreamHigh('cortico', 'art')).toBe(false)
  })
})
