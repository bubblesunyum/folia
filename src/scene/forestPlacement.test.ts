// Forest placement pin (fol-9eq): the pure core behind `ForestEdge` is
// deterministic — same seed, same rings — and fails closed on drift, so a
// params edit or a town-file move breaks here instead of scattering trees.

import { describe, expect, it } from 'vitest'
import forestParams from '../../assets/blender/folia/foliage_params.json' with { type: 'json' }
import art from '../../content/town/art.json' with { type: 'json' }
import {
  chaikin,
  distToCourse,
  type ForestConfig,
  forestRing,
  mulberry32,
  parseForestConfig,
  parseRingInputs,
  type RingInputs,
  readForestConfig,
  readRingInputs,
  type XZ,
} from './forestPlacement'

interface ForestSectionJson {
  seed: number
  keep_river_m: number
  keep_plot_m: number
  near: { count: number; r0: number; r1: number; canopy_radii: number[]; sink: number }
  mid: { count: number; r0: number; r1: number; card_w: number; card_h: number; lift: number }
  far: { skirt_r: number; skirt_top: number; skirt_tuck: number; segments: number }
}

const forestSection = (forestParams as { forest: ForestSectionJson }).forest

function openInputs(): RingInputs {
  return {
    course: [
      [-500, -500],
      [-400, -500],
    ],
    halfWidth: 1,
    pads: [],
    artCentre: [500, 500],
  }
}

function testConfig(): ForestConfig {
  return {
    seed: 11,
    keepRiver: 12,
    keepPlot: 6,
    near: { count: 110, r0: 44, r1: 78, radii: [2.0, 1.7, 1.3], sink: 0.5 },
    mid: { count: 70, r0: 58, r1: 102, w: 7, h: 8, lift: -0.5 },
    far: { radius: 150, top: 16, tuck: 4, segments: 128 },
    moundClear: 22,
  }
}

describe('chaikin', () => {
  it('pins two passes on a straight segment', () => {
    const out = chaikin([
      [0, 0],
      [4, 0],
    ])
    expect(out).toHaveLength(8)
    expect(out.map(([x]) => x)).toEqual([0, 0.25, 0.75, 1.5, 2.5, 3.25, 3.75, 4])
    for (const [, z] of out) expect(z).toBe(0)
  })

  it('keeps the endpoints and doubles twice', () => {
    const pts: XZ[] = [
      [-8, -110],
      [-16, -88],
      [-22, -66],
    ]
    const out = chaikin(pts)
    expect(out).toHaveLength(pts.length * 4)
    expect(out[0]).toEqual([-8, -110])
    expect(out[out.length - 1]).toEqual([-22, -66])
  })

  it('leaves the input alone', () => {
    const pts: XZ[] = [
      [0, 0],
      [4, 0],
    ]
    chaikin(pts)
    expect(pts).toEqual([
      [0, 0],
      [4, 0],
    ])
  })
})

describe('distToCourse', () => {
  const course: XZ[] = [
    [0, 0],
    [10, 0],
  ]

  it('measures perpendicular distance', () => {
    expect(distToCourse(5, 3, course)).toBeCloseTo(3, 12)
  })

  it('is zero on the segment', () => {
    expect(distToCourse(5, 0, course)).toBeCloseTo(0, 12)
  })

  it('clamps past the endpoints', () => {
    expect(distToCourse(15, 0, course)).toBeCloseTo(5, 12)
    expect(distToCourse(-3, 4, course)).toBeCloseTo(5, 12)
  })

  it('takes the nearest leg of a polyline', () => {
    const bent: XZ[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    expect(distToCourse(5, 5, bent)).toBeCloseTo(5, 12)
    expect(distToCourse(10, 5, bent)).toBeCloseTo(0, 12)
  })

  it('never NaNs on a degenerate leg', () => {
    expect(
      distToCourse(4, 5, [
        [1, 1],
        [1, 1],
      ]),
    ).toBeCloseTo(5, 12)
  })
})

describe('mulberry32', () => {
  it('replays the same stream per seed', () => {
    const a = mulberry32(11)
    const b = mulberry32(11)
    for (let i = 0; i < 10; i += 1) expect(a()).toBe(b())
  })

  it('splits streams across seeds', () => {
    expect(mulberry32(11)()).not.toBe(mulberry32(12)())
  })
})

describe('forestRing', () => {
  it('is deterministic per seed', () => {
    const config = testConfig()
    const inputs = openInputs()
    const run = () => forestRing(mulberry32(config.seed), config, inputs, 20, 44, 78)
    expect(run()).toEqual(run())
  })

  it('lands inside the annulus', () => {
    const pts = forestRing(mulberry32(11), testConfig(), openInputs(), 50, 44, 78)
    expect(pts).toHaveLength(50)
    for (const [x, z] of pts) {
      const r = Math.hypot(x, z)
      expect(r).toBeGreaterThanOrEqual(44)
      expect(r).toBeLessThanOrEqual(78)
    }
  })

  it('keeps the river, pads and mound clear', () => {
    const config = testConfig()
    const inputs: RingInputs = {
      course: [
        [-200, 0],
        [200, 0],
      ],
      halfWidth: 3.5,
      pads: [{ x: 60, z: 0, r: 10 }],
      artCentre: [0, -60],
    }
    const pts = forestRing(mulberry32(11), config, inputs, 50, 44, 78)
    for (const [x, z] of pts) {
      expect(distToCourse(x, z, inputs.course)).toBeGreaterThanOrEqual(
        inputs.halfWidth + config.keepRiver,
      )
      for (const pad of inputs.pads) {
        expect(Math.hypot(x - pad.x, z - pad.z)).toBeGreaterThanOrEqual(pad.r + config.keepPlot)
      }
      expect(Math.hypot(x - inputs.artCentre[0], z - inputs.artCentre[1])).toBeGreaterThanOrEqual(
        config.moundClear,
      )
    }
  })

  it('fails closed when nothing fits', () => {
    const config = testConfig()
    const blocked: RingInputs = {
      course: [
        [-200, 0],
        [200, 0],
      ],
      halfWidth: 1000,
      pads: [],
      artCentre: [500, 500],
    }
    expect(() => forestRing(mulberry32(11), config, blocked, 5, 44, 78)).toThrow(
      /forest: ring placed/,
    )
  })
})

describe('parseForestConfig', () => {
  it('reads the owning retune point', () => {
    const config = parseForestConfig(forestParams, art)
    expect(config.seed).toBe(forestSection.seed)
    expect(config.keepRiver).toBe(forestSection.keep_river_m)
    expect(config.keepPlot).toBe(forestSection.keep_plot_m)
    expect(config.near).toMatchObject({
      count: forestSection.near.count,
      r0: forestSection.near.r0,
      r1: forestSection.near.r1,
      sink: forestSection.near.sink,
    })
    expect(config.near.radii).toEqual(forestSection.near.canopy_radii)
    expect(config.mid).toMatchObject({
      count: forestSection.mid.count,
      w: forestSection.mid.card_w,
      h: forestSection.mid.card_h,
    })
    expect(config.far.radius).toBe(forestSection.far.skirt_r)
    expect(config.moundClear).toBe(art.mound_sigma + 6)
  })

  it('fails closed on drift', () => {
    expect(() => parseForestConfig({}, art)).toThrow(/no "forest" section/)
    expect(() => parseForestConfig({ forest: null }, art)).toThrow()
    expect(() => parseForestConfig({ forest: {} }, art)).toThrow(/no "near" section/)
    expect(() => parseForestConfig({ forest: { ...forestSection, near: {} } }, art)).toThrow()
    expect(() =>
      parseForestConfig(
        { forest: { ...forestSection, near: { ...forestSection.near, count: NaN } } },
        art,
      ),
    ).toThrow(/near\.count/)
    expect(() =>
      parseForestConfig(
        { forest: { ...forestSection, near: { ...forestSection.near, canopy_radii: [] } } },
        art,
      ),
    ).toThrow(/canopy_radii is empty/)
    expect(() => parseForestConfig({ forest: forestSection }, {})).toThrow(/mound_sigma/)
  })
})

describe('parseRingInputs', () => {
  const hood = (hoodName: string, centre: [number, number], radius: number) => ({
    file: `content/town/${hoodName}.json`,
    raw: { hood: hoodName, centre, yaw: 0, radius, bank: 'none', order: 0 },
  })

  it('smooths the river course and halves its width', () => {
    const inputs = parseRingInputs([hood('art', [10, 20], 5), hood('cortico', [0, 0], 18)], {
      course: [
        [0, 0],
        [10, 0],
      ],
      width: 7,
    })
    expect(inputs.halfWidth).toBe(3.5)
    expect(inputs.course).toHaveLength(8)
    expect(inputs.artCentre).toEqual([10, 20])
  })

  it('leaves cortico out of the pads, like the bake', () => {
    const inputs = parseRingInputs([hood('art', [10, 20], 5), hood('cortico', [0, 0], 18)], {
      course: [
        [0, 0],
        [10, 0],
      ],
      width: 7,
    })
    expect(inputs.pads).toHaveLength(1)
    expect(inputs.pads[0]).toMatchObject({ x: 10, z: 20, r: 5 })
  })

  it('fails closed on drift', () => {
    const hoods = [hood('art', [10, 20], 5)]
    expect(() => parseRingInputs(hoods, { course: [[0, 0]], width: 7 })).toThrow(/too short/)
    expect(() => parseRingInputs(hoods, { course: [[0, 0], 7], width: 7 })).toThrow(/not a pair/)
    expect(() =>
      parseRingInputs([hood('cortico', [0, 0], 18)], {
        course: [
          [0, 0],
          [10, 0],
        ],
        width: 7,
      }),
    ).toThrow(/no art placement/)
    expect(() =>
      parseRingInputs(hoods, {
        course: [
          [0, 0],
          [10, 0],
        ],
      }),
    ).toThrow(/river width/)
  })
})

describe('owning files (fol-9eq)', () => {
  it('readForestConfig matches the checked-in params', () => {
    expect(readForestConfig()).toEqual(parseForestConfig(forestParams, art))
  })

  it('readRingInputs covers every hood but cortico, smoothed', () => {
    const inputs = readRingInputs()
    // Nine river points through two Chaikin passes.
    expect(inputs.course).toHaveLength(9 * 4)
    expect(inputs.halfWidth).toBeCloseTo(3.5, 12)
    // Nine hood files, minus cortico (the identity disc, not a pad).
    expect(inputs.pads).toHaveLength(8)
    expect(inputs.artCentre).toEqual(art.centre)
  })

  it('places both rig rings deterministically and clear', () => {
    const config = readForestConfig()
    const run = () => {
      const random = mulberry32(config.seed)
      return {
        near: forestRing(
          random,
          config,
          readRingInputs(),
          config.near.count,
          config.near.r0,
          config.near.r1,
        ),
        mid: forestRing(
          random,
          config,
          readRingInputs(),
          config.mid.count,
          config.mid.r0,
          config.mid.r1,
        ),
      }
    }
    const first = run()
    const second = run()
    expect(first).toEqual(second)
    expect(first.near).toHaveLength(config.near.count)
    expect(first.mid).toHaveLength(config.mid.count)
    const inputs = readRingInputs()
    for (const [pts, r0, r1] of [
      [first.near, config.near.r0, config.near.r1],
      [first.mid, config.mid.r0, config.mid.r1],
    ] as const) {
      for (const [x, z] of pts as XZ[]) {
        const r = Math.hypot(x, z)
        expect(r).toBeGreaterThanOrEqual((r0 as number) - 1e-9)
        expect(r).toBeLessThanOrEqual((r1 as number) + 1e-9)
        expect(distToCourse(x, z, inputs.course)).toBeGreaterThanOrEqual(
          inputs.halfWidth + config.keepRiver,
        )
        expect(Math.hypot(x - inputs.artCentre[0], z - inputs.artCentre[1])).toBeGreaterThanOrEqual(
          config.moundClear,
        )
      }
    }
  })
})
