// The D-072 delivery split, derived from one source (fol-l7d.2): each
// hood ships a `.mid` town read (≤1 MB / 75k tris) plus a `.high` hero
// stream (≤2 MB / 200k), inside the 3 MB / 275k combined ceiling. The split
// is recorded per asset in `assets/manifest.json` (`lods`, written by
// `scripts/lib/split-lods.mjs`): this module is the one reader both the
// gate (`scripts/budget.mjs`, which fails each half independently) and the
// client (mid at `/`, high streamed at the vantage) derive from, so the
// two can never drift. Pure and three-free like the rest of this directory,
// so the gate imports it straight from Node.
//
// Budgets read from the owning file: the caps below own the numbers, and
// the gate enforces them — never a hand copy.

import manifest from '../../assets/manifest.json' with { type: 'json' }

/** One side of an asset's split: the delivery file plus its cost. */
export interface LodSide {
  /** The GLB stem under `public/assets`, e.g. `cortico/fragment.mid`. */
  file: string
  bytes: number
  triangles: Record<string, number>
}

/** An asset's recorded split. Single-LOD assets carry exactly one side. */
export interface AssetLods {
  mid?: LodSide
  high?: LodSide
}

export interface ManifestRecord {
  hash: string
  bytes: number
  triangles: Record<string, number>
  vertices?: Record<string, number>
  indices?: Record<string, number>
  groups?: Record<string, number>
  /** Written by `scripts/lib/split-lods.mjs`; absent until the split runs. */
  lods?: AssetLods
  /** The full-export bytes the twins were split from (staleness anchor). */
  sourceBytes?: number
}

export type AssetManifest = Record<string, ManifestRecord>

/** The committed manifest, for client lookups (the lightPool precedent). */
export const assetManifest: AssetManifest = manifest as AssetManifest

// Breadth starting allowance (D-072): 1 MB / 75k of town mid-LOD per hood,
// plus 2 MB / 200k of additional streamed hero detail, inside the combined
// 3 MB / 275k ceiling. A delivery increase never raises the frame target.
export const MID_BYTES = 1_000_000
export const MID_TRIS = 75_000
export const HIGH_BYTES = 2_000_000
export const HIGH_TRIS = 200_000
export const HOOD_BYTES = 3_000_000
export const HOOD_TRIS = 275_000

/** The hood an asset belongs to: `<hood>/<object>` → `<hood>`. */
export function hoodOf(asset: string): string {
  return asset.split('/')[0] ?? asset
}

export interface LodStems {
  /** The town-read file stem, always present. */
  mid: string
  /** The hero-stream stem, or null for single-LOD assets. */
  high: string | null
}

/**
 * An asset's delivery files, fail closed: a missing record or a record the
 * splitter hasn't stamped yet throws instead of loading the wrong LOD.
 */
export function lodStems(asset: string, records: AssetManifest = assetManifest): LodStems {
  const record = records[asset]
  if (!record) throw new Error(`lods: no asset "${asset}" in assets/manifest.json`)
  const { lods } = record
  if (!lods || (!lods.mid && !lods.high)) {
    throw new Error(`lods: "${asset}" has no LOD split — run node scripts/lib/split-lods.mjs`)
  }
  if (!lods.mid) throw new Error(`lods: "${asset}" has no mid side — it cannot load at /`)
  return { mid: lods.mid.file, high: lods.high?.file ?? null }
}

export interface HoodLodTotals {
  mid: { bytes: number; tris: number }
  high: { bytes: number; tris: number }
  all: { bytes: number; tris: number }
}

const empty = () => ({ bytes: 0, tris: 0 })

function sideTris(side: LodSide): number {
  return Object.values(side.triangles).reduce((a, b) => a + b, 0)
}

/**
 * Per-hood byte and triangle totals per half of the split, from the owning
 * file. Throws fail-closed on a record the splitter hasn't stamped or whose
 * sides drifted from its top-level totals.
 */
export function hoodLodTotals(records: AssetManifest): Record<string, HoodLodTotals> {
  const hoods: Record<string, HoodLodTotals> = {}
  for (const [asset, record] of Object.entries(records)) {
    const { lods } = record
    if (!lods || (!lods.mid && !lods.high)) {
      throw new Error(`lods: "${asset}" has no LOD split — run node scripts/lib/split-lods.mjs`)
    }
    let hood = hoods[hoodOf(asset)]
    if (!hood) {
      hood = { mid: empty(), high: empty(), all: empty() }
      hoods[hoodOf(asset)] = hood
    }
    for (const [half, side] of Object.entries(lods) as ['mid' | 'high', LodSide][]) {
      hood[half].bytes += side.bytes
      hood[half].tris += sideTris(side)
    }
    const splitBytes = (lods.mid?.bytes ?? 0) + (lods.high?.bytes ?? 0)
    if (splitBytes !== record.bytes) {
      throw new Error(
        `lods: "${asset}" sides sum to ${splitBytes} bytes but the record lists ${record.bytes}`,
      )
    }
    const splitTris = (lods.mid ? sideTris(lods.mid) : 0) + (lods.high ? sideTris(lods.high) : 0)
    const recordTris = Object.values(record.triangles).reduce((a, b) => a + b, 0)
    if (splitTris !== recordTris) {
      throw new Error(
        `lods: "${asset}" sides sum to ${splitTris} tris but the record lists ${recordTris}`,
      )
    }
  }
  for (const hood of Object.values(hoods)) {
    hood.all.bytes = hood.mid.bytes + hood.high.bytes
    hood.all.tris = hood.mid.tris + hood.high.tris
  }
  return hoods
}

/**
 * Every way `records` break the D-072 split; empty when they don't. Each half
 * fails on its own cap independently of the other half and the combined
 * ceiling, so a mid blowout can never hide behind high headroom.
 */
export function checkLodBudgets(records: AssetManifest): string[] {
  const errors: string[] = []
  let totals: Record<string, HoodLodTotals>
  try {
    totals = hoodLodTotals(records)
  } catch (error) {
    return [(error as Error).message]
  }
  for (const [hood, hoodTotal] of Object.entries(totals)) {
    if (hoodTotal.mid.bytes > MID_BYTES) {
      errors.push(`${hood} mid bytes ${hoodTotal.mid.bytes} over allowance ${MID_BYTES}`)
    }
    if (hoodTotal.mid.tris > MID_TRIS) {
      errors.push(`${hood} mid tris ${hoodTotal.mid.tris} over allowance ${MID_TRIS}`)
    }
    if (hoodTotal.high.bytes > HIGH_BYTES) {
      errors.push(`${hood} high bytes ${hoodTotal.high.bytes} over allowance ${HIGH_BYTES}`)
    }
    if (hoodTotal.high.tris > HIGH_TRIS) {
      errors.push(`${hood} high tris ${hoodTotal.high.tris} over allowance ${HIGH_TRIS}`)
    }
    if (hoodTotal.all.bytes > HOOD_BYTES) {
      errors.push(`${hood} combined bytes ${hoodTotal.all.bytes} over allowance ${HOOD_BYTES}`)
    }
    if (hoodTotal.all.tris > HOOD_TRIS) {
      errors.push(`${hood} combined tris ${hoodTotal.all.tris} over allowance ${HOOD_TRIS}`)
    }
  }
  return errors
}

/**
 * Whether `hood`'s hero stream joins the town: at its vantage (`/<hood>` and
 * below) the high LOD streams in; at `/` the town loads mid only. Pure, so
 * the route rule is pinned in vitest instead of pixels.
 */
export function shouldStreamHigh(project: string | undefined, hood: string): boolean {
  return project === hood
}
