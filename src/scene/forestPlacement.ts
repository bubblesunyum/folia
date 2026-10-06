// Forest placement math (fol-9eq): the pure core behind `ForestEdge`.
// Everything here is plain numbers — no three, no R3F — so Vitest pins it
// without a renderer (D-047). The rig in `ForestEdge.tsx` only wires the
// results into instanced meshes.
//
// Placement is single-sourced in `content/town/` (hood pads, river course —
// the same files `town.py` bakes from) plus the `forest` section of
// `foliage_params.json` (the same retune point the bake reads). Fail closed
// like the bake: any drift throws instead of placing trees nowhere.

import forestParams from '../../assets/blender/folia/foliage_params.json' with { type: 'json' }
import art from '../../content/town/art.json' with { type: 'json' }
import blackjack from '../../content/town/blackjack-genius.json' with { type: 'json' }
import cortico from '../../content/town/cortico.json' with { type: 'json' }
import earlyWork from '../../content/town/early-work.json' with { type: 'json' }
import expressMess from '../../content/town/express-your-mess.json' with { type: 'json' }
import expressYes from '../../content/town/express-your-yes.json' with { type: 'json' }
import glyphite from '../../content/town/glyphite.json' with { type: 'json' }
import ironOx from '../../content/town/iron-ox.json' with { type: 'json' }
import purple from '../../content/town/purple-republic.json' with { type: 'json' }
import river from '../../content/town/river.json' with { type: 'json' }
import { type HoodPlacement, parseHoodPlacement } from '../assets/townBatches'

export const TAU = Math.PI * 2

export interface ForestConfig {
  seed: number
  keepRiver: number
  keepPlot: number
  near: { count: number; r0: number; r1: number; radii: readonly number[]; sink: number }
  mid: { count: number; r0: number; r1: number; w: number; h: number; lift: number }
  far: { radius: number; top: number; tuck: number; segments: number }
  moundClear: number
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`forest: ${what} is not a finite number`)
  }
  return value
}

/**
 * Parses the `forest` retune point, fail closed like the bake (`town.py`).
 * Takes the raw JSON so Vitest can pin the failure modes without fixtures.
 */
export function parseForestConfig(paramsJson: unknown, artJson: unknown): ForestConfig {
  const raw = (paramsJson as { forest?: unknown }).forest as Record<string, unknown> | undefined
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('forest: foliage_params.json has no "forest" section')
  }
  const section = (name: string): Record<string, unknown> => {
    const part = raw[name]
    if (typeof part !== 'object' || part === null) throw new Error(`forest: no "${name}" section`)
    return part as Record<string, unknown>
  }
  const near = section('near')
  const mid = section('mid')
  const far = section('far')
  const radii = near.canopy_radii
  if (!Array.isArray(radii) || radii.length === 0) {
    throw new Error('forest: near.canopy_radii is empty')
  }
  return {
    seed: finite(raw.seed, 'seed'),
    keepRiver: finite(raw.keep_river_m, 'keep_river_m'),
    keepPlot: finite(raw.keep_plot_m, 'keep_plot_m'),
    near: {
      count: finite(near.count, 'near.count'),
      r0: finite(near.r0, 'near.r0'),
      r1: finite(near.r1, 'near.r1'),
      radii: radii.map((r, i) => finite(r, `near.canopy_radii[${i}]`)),
      sink: finite(near.sink, 'near.sink'),
    },
    mid: {
      count: finite(mid.count, 'mid.count'),
      r0: finite(mid.r0, 'mid.r0'),
      r1: finite(mid.r1, 'mid.r1'),
      w: finite(mid.card_w, 'mid.card_w'),
      h: finite(mid.card_h, 'mid.card_h'),
      lift: finite(mid.lift, 'mid.lift'),
    },
    far: {
      radius: finite(far.skirt_r, 'far.skirt_r'),
      top: finite(far.skirt_top, 'far.skirt_top'),
      tuck: finite(far.skirt_tuck, 'far.skirt_tuck'),
      segments: finite(far.segments, 'far.segments'),
    },
    moundClear: finite((artJson as { mound_sigma?: unknown }).mound_sigma, 'art.mound_sigma') + 6,
  }
}

/** The `forest` retune point from the owning files. */
export function readForestConfig(): ForestConfig {
  return parseForestConfig(forestParams, art)
}

export type XZ = readonly [number, number]

/** Seeded stream: stable placement across reloads, no cross-frame cost. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two Chaikin passes, the `town.py` smoothing the keep-clear measures against. */
export function chaikin(points: XZ[]): XZ[] {
  let pts: XZ[] = points.map(([x, z]) => [x, z] as XZ)
  for (let k = 0; k < 2; k += 1) {
    const out: XZ[] = [pts[0] as XZ]
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i] as XZ
      const b = pts[i + 1] as XZ
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]])
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    out.push(pts[pts.length - 1] as XZ)
    pts = out
  }
  return pts
}

export function distToCourse(x: number, z: number, course: XZ[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < course.length - 1; i += 1) {
    const [ax, az] = course[i] as XZ
    const [bx, bz] = course[i + 1] as XZ
    const dx = bx - ax
    const dz = bz - az
    const denom = Math.max(dx * dx + dz * dz, 1e-9)
    const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / denom, 0), 1)
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

export interface RingInputs {
  course: XZ[]
  halfWidth: number
  pads: { x: number; z: number; r: number }[]
  artCentre: XZ
}

export interface HoodRaw {
  file: string
  raw: unknown
}

/**
 * Builds ring inputs from the owning files, fail closed on drift. Takes the
 * raw JSON so Vitest can pin the failure modes without fixtures.
 */
export function parseRingInputs(hoods: readonly HoodRaw[], riverJson: unknown): RingInputs {
  const placements: HoodPlacement[] = hoods.map(({ file, raw }) => parseHoodPlacement(raw, file))
  const courseRaw = (riverJson as { course?: unknown }).course
  if (!Array.isArray(courseRaw) || courseRaw.length < 2) {
    throw new Error('forest: river.json course too short')
  }
  const course: XZ[] = courseRaw.map((point, i) => {
    if (!Array.isArray(point) || point.length < 2)
      throw new Error(`forest: river course[${i}] is not a pair`)
    return [
      finite(point[0], `river course[${i}][0]`),
      finite(point[1], `river course[${i}][1]`),
    ] as XZ
  })
  const artPlacement = placements.find((p) => p.hood === 'art')
  if (!artPlacement) throw new Error('forest: no art placement for the mound clear')
  // Cortico is the flattened identity disc at the origin, not a plot pad:
  // the bake's `pads` list (what `forest_ring` keeps clear of) has no
  // cortico entry, so this filter mirrors it instead of punching an 18 m
  // hole at the town centre. Art keeps its pad: the mound clear below
  // handles the hill, the pad clear handles the platform.
  const pads = placements
    .filter((p) => p.hood !== 'cortico')
    .map((p) => ({ x: p.centre[0], z: p.centre[1], r: p.radius }))
  return {
    course: chaikin(course),
    halfWidth: finite((riverJson as { width?: unknown }).width, 'river width') / 2,
    pads,
    artCentre: artPlacement.centre,
  }
}

const HOOD_FILES: HoodRaw[] = [
  { file: 'content/town/art.json', raw: art },
  { file: 'content/town/blackjack-genius.json', raw: blackjack },
  { file: 'content/town/cortico.json', raw: cortico },
  { file: 'content/town/early-work.json', raw: earlyWork },
  { file: 'content/town/express-your-mess.json', raw: expressMess },
  { file: 'content/town/express-your-yes.json', raw: expressYes },
  { file: 'content/town/glyphite.json', raw: glyphite },
  { file: 'content/town/iron-ox.json', raw: ironOx },
  { file: 'content/town/purple-republic.json', raw: purple },
]

/**
 * Ring inputs from the owning files. The same per-hood files
 * `town.py::load_placement` globs from `content/town/` (every hood file plus
 * the river course): the bake and this layer read the owning files, never a
 * hand copy, and the real filename rides into `parseHoodPlacement` so drift
 * errors name the file.
 */
export function readRingInputs(): RingInputs {
  return parseRingInputs(HOOD_FILES, river)
}

/** Area-uniform annulus points clear of river, pads and the art mound —
 * the `town.py::forest_ring` definition, same inputs, same keep-clear. */
export function forestRing(
  random: () => number,
  config: ForestConfig,
  inputs: RingInputs,
  count: number,
  r0: number,
  r1: number,
): XZ[] {
  const pts: XZ[] = []
  let guard = 0
  while (pts.length < count && guard < count * 60) {
    guard += 1
    const angle = random() * TAU
    const r = Math.sqrt(r0 * r0 + random() * (r1 * r1 - r0 * r0))
    const x = r * Math.cos(angle)
    const z = r * Math.sin(angle)
    if (distToCourse(x, z, inputs.course) < inputs.halfWidth + config.keepRiver) continue
    if (inputs.pads.some((pad) => Math.hypot(x - pad.x, z - pad.z) < pad.r + config.keepPlot)) {
      continue
    }
    if (Math.hypot(x - inputs.artCentre[0], z - inputs.artCentre[1]) < config.moundClear) continue
    pts.push([x, z])
  }
  if (pts.length < count) throw new Error(`forest: ring placed ${pts.length}/${count}`)
  return pts
}
