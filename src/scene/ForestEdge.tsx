// Forest edge fading to the horizon (fol-l7d.5, spec Phase 2): three layers
// in height fog (D-046/D-064), all on shared materials so fog and sky share
// one uniform object and no new program compiles.
//
// - Near: true repeats (D-032) as one `InstancedMesh` of canopy blobs on the
//   shared foliage program — never gltf-transform `instance()` into a
//   `BatchedMesh` (D-033). Per-instance phase rides the instance matrix, so
//   shared geometry never sways in lockstep; the weight is the swayModel bake
//   curve over template height.
// - Mid: single-view baked cards (R-010) as one `InstancedMesh` of vertical
//   quads, every card yawed at the town centre, so no vantage frames the band
//   at a new pitch (D-050). Static (`_sway` 0): cards are baked, only the
//   near repeats move.
// - Far: the horizon skirt, one inward-wound ring on the shared ground
//   program, its level top melting into the sky gradient through the shared
//   height fog.
//
// Placement is single-sourced in `content/town/` (hood pads, river course —
// the same files `town.py` bakes from) plus the `forest` section of
// `foliage_params.json` (the same retune point the bake reads). The baked
// town skeleton carries mid cards + skirt with real group slots; this runtime
// layer carries all three until that asset lands, kept apart from the bake
// by radii, never by identity. Forest takes no hover: every vertex carries
// the top group slot, which the append-only pack allocator (D-061) only
// reaches when the town fills the strip — breadth relocates the forest slot
// if that ever happens.
//
// Static once mounted: no `useFrame`, no per-frame invalidation, so
// `?sway=off` rests at zero draws and the shadow pass never sees it
// (`castShadow` stays off — the ±16 m fits end long before the first tree).

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  type BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
import { MAX_GROUPS } from '../groupSlots'
import { materials } from '../materials/shared'
import { swayWeight } from '../materials/swayModel'

/** Inert group slot: never pickable (this layer never registers volumes),
 * so its lift/glow state stays zero. See the module note on relocation. */
const FOREST_SLOT = MAX_GROUPS - 1

const TAU = Math.PI * 2

interface ForestConfig {
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

/** The `forest` retune point, fail closed like the bake (`town.py`). */
function readForestConfig(): ForestConfig {
  const raw = (forestParams as { forest?: unknown }).forest as Record<string, unknown> | undefined
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
    moundClear: finite((art as { mound_sigma?: unknown }).mound_sigma, 'art.mound_sigma') + 6,
  }
}

type XZ = readonly [number, number]

/** Seeded stream: stable placement across reloads, no cross-frame cost. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two Chaikin passes, the `town.py` smoothing the keep-clear measures against. */
function chaikin(points: XZ[]): XZ[] {
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

function distToCourse(x: number, z: number, course: XZ[]): number {
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

interface RingInputs {
  course: XZ[]
  halfWidth: number
  pads: { x: number; z: number; r: number }[]
  artCentre: XZ
}

/** Area-uniform annulus points clear of river, pads and the art mound —
 * the `town.py::forest_ring` definition, same inputs, same keep-clear. */
function forestRing(
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

function readRingInputs(): RingInputs {
  // The same per-hood files `town.py::load_placement` globs from
  // `content/town/` (every hood file plus the river course): the bake and
  // this layer read the owning files, never a hand copy, and the real
  // filename rides into `parseHoodPlacement` so drift errors name the file.
  const raws: Array<[file: string, raw: unknown]> = [
    ['content/town/art.json', art],
    ['content/town/blackjack-genius.json', blackjack],
    ['content/town/cortico.json', cortico],
    ['content/town/early-work.json', earlyWork],
    ['content/town/express-your-mess.json', expressMess],
    ['content/town/express-your-yes.json', expressYes],
    ['content/town/glyphite.json', glyphite],
    ['content/town/iron-ox.json', ironOx],
    ['content/town/purple-republic.json', purple],
  ]
  const placements: HoodPlacement[] = raws.map(([file, raw]) => parseHoodPlacement(raw, file))
  const courseRaw = (river as { course?: unknown }).course
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
    halfWidth: finite((river as { width?: unknown }).width, 'river width') / 2,
    pads,
    artCentre: artPlacement.centre,
  }
}

/** Paints the shared-program channels every town piece carries (see
 * `StressDraws`): the inert group slot, baked AO, no night spill, and the
 * sway weight over template height (or zero for baked cards). The canopy AO
 * darkens toward the dirt line — the runtime half of the clump-core gradient
 * (D-045): undersides sit instead of glowing. */
function paintSharedChannels(
  geometry: BufferGeometry,
  sway: (y: number) => number,
  ao: (y: number) => number,
): void {
  const position = geometry.attributes.position
  if (!position) throw new Error('forest: template has no position')
  const count = position.count
  geometry.setAttribute(
    'groupId',
    new BufferAttribute(new Float32Array(count).fill(FOREST_SLOT), 1),
  )
  const aoValues = new Float32Array(count)
  for (let i = 0; i < count; i += 1) aoValues[i] = ao(position.getY(i))
  geometry.setAttribute('bakedAo', new BufferAttribute(aoValues, 1))
  geometry.setAttribute('bakedNight', new BufferAttribute(new Float32Array(count * 3), 3))
  const weights = new Float32Array(count)
  for (let i = 0; i < count; i += 1) weights[i] = sway(position.getY(i))
  geometry.setAttribute('_sway', new BufferAttribute(weights, 1))
}

/** Underside occlusion for the canopy: full AO at the dirt line, open above. */
function canopyAo(y: number): number {
  const t = Math.min(Math.max((y - 0.5) / 3, 0), 1)
  return 0.62 + 0.38 * t
}

const _dummy = new Object3D()

function buildCanopyTemplate(radii: readonly number[]): BufferGeometry {
  const blobs = radii.map((r, i) => {
    const blob = new IcosahedronGeometry(r, 1)
    blob.scale(1, 0.8, 1)
    // Stacked lobes around a rising core: one soft mass, never one ball.
    const angle = (i / Math.max(radii.length, 1)) * TAU
    blob.translate(Math.cos(angle) * r * 0.45, 2.4 + i * 1.1, Math.sin(angle) * r * 0.45)
    return blob
  })
  const merged = mergeGeometries(blobs)
  for (const blob of blobs) blob.dispose()
  if (!merged) throw new Error('forest: canopy template failed to merge')
  return merged
}

function setInstances(mesh: InstancedMesh, place: (index: number) => void): void {
  for (let i = 0; i < mesh.count; i += 1) {
    _dummy.position.set(0, 0, 0)
    _dummy.rotation.set(0, 0, 0)
    _dummy.scale.set(1, 1, 1)
    place(i)
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  if (!mesh.boundingSphere) throw new Error('forest: instanced layer has no bounds')
}

export function ForestEdge() {
  const invalidate = useThree((state) => state.invalidate)

  const layers = useMemo(() => {
    const config = readForestConfig()
    const inputs = readRingInputs()
    const random = mulberry32(config.seed)

    const foliage = materials.foliage
    const ground = materials.ground
    if (!foliage || !ground) throw new Error('forest: no shared foliage/ground material')

    // Near: one canopy template, instanced around the clearing.
    const canopy = buildCanopyTemplate(config.near.radii)
    canopy.deleteAttribute('uv')
    paintSharedChannels(canopy, (y) => swayWeight(y), canopyAo)
    const nearSpots = forestRing(
      random,
      config,
      inputs,
      config.near.count,
      config.near.r0,
      config.near.r1,
    )
    const near = new InstancedMesh(canopy, foliage.material, nearSpots.length)
    setInstances(near, (i) => {
      const [x, z] = nearSpots[i] as XZ
      _dummy.position.set(x, -config.near.sink, z)
      _dummy.rotation.set(0, random() * TAU, 0)
      const s = 0.8 + random() * 0.5
      _dummy.scale.set(s, 0.9 + random() * 0.4, s)
    })

    // Mid: single-view cards, every one yawed at the town centre (R-010).
    const card = new PlaneGeometry(config.mid.w, config.mid.h)
    card.translate(0, config.mid.h / 2, 0)
    card.deleteAttribute('uv')
    paintSharedChannels(
      card,
      () => 0,
      () => 1,
    )
    const cardSpots = forestRing(
      random,
      config,
      inputs,
      config.mid.count,
      config.mid.r0,
      config.mid.r1,
    )
    const cards = new InstancedMesh(card, foliage.material, cardSpots.length)
    setInstances(cards, (i) => {
      const [x, z] = cardSpots[i] as XZ
      _dummy.position.set(x, config.mid.lift, z)
      _dummy.rotation.set(0, Math.atan2(-x, -z), 0)
      const s = 0.85 + random() * 0.4
      _dummy.scale.set(s, 0.9 + random() * 0.3, 1)
    })

    // Far: the horizon skirt, mirrored to wind inward, level top.
    const skirtHeight = config.far.top + config.far.tuck
    const skirt = new CylinderGeometry(
      config.far.radius,
      config.far.radius,
      skirtHeight,
      config.far.segments,
      1,
      true,
    )
    skirt.translate(0, config.far.top - skirtHeight / 2, 0)
    skirt.scale(-1, 1, 1)
    skirt.deleteAttribute('uv')
    {
      const count = skirt.attributes.position?.count ?? 0
      skirt.setAttribute(
        'groupId',
        new BufferAttribute(new Float32Array(count).fill(FOREST_SLOT), 1),
      )
      skirt.setAttribute('bakedAo', new BufferAttribute(new Float32Array(count).fill(1), 1))
      skirt.setAttribute('bakedNight', new BufferAttribute(new Float32Array(count * 3), 3))
    }
    const skirtMaterial = ground.material
    return { near, cards, skirt, skirtMaterial }
  }, [])

  // One frame for the demand loop; afterwards this layer never invalidates.
  useEffect(() => {
    invalidate()
  }, [invalidate])

  useEffect(
    () => () => {
      layers.near.geometry.dispose()
      layers.cards.geometry.dispose()
      layers.skirt.dispose()
      layers.near.dispose()
      layers.cards.dispose()
    },
    [layers],
  )

  return (
    <>
      <primitive object={layers.near} />
      <primitive object={layers.cards} />
      <mesh geometry={layers.skirt} material={layers.skirtMaterial} />
    </>
  )
}
