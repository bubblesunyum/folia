// Additive light-pool decals (D-038, fol-0sj, fol-kes.4, fol-kes.15): warm
// pools of lantern light drawn as flat decals on the terrace walk lines,
// where lanterns and paths will go. The spots are authored at bake in
// assets/blender/cortico/fragment.py on the live terrace outlines; the
// runtime reads the pools-only sibling fragment.pools.only.json (the
// forum-layout.json anchor precedent) — the full fragment.pools.json keeps
// the outlines and bake provenance for the placement spec, never the canvas
// chunk. The runtime only builds the merged quad mesh, never grounds,
// raycasts, or polls. No lantern geometry exists yet, so these baked spots
// stand in for the future lantern/planter spill until the fragment models them.
//
// One draw call: every pool is a quad in a single merged geometry sharing
// one composed material (fol-kes.15). No new lights (D-038's fixed light
// count is untouched), no selective-bloom passes. Daylight inert: opacity
// rides the night weight (zero by day) and the component hides the mesh
// until night.
//
// fol-kes.15: the pools ride the composer like every other surface —
// `worldPosition` first (the one shared varying), the owner's `groupLift`
// (pools carry the terrace slot, so a hover lifts them with the terraces),
// the `revealBasic` cream band, the `lightPool` falloff itself (pools rise
// with the town, never before it), and `heightFogAdditive` (an additive
// shell attenuates toward black, never fogging over — the neonGlow
// precedent). Value writes only, never a recompile: the keys carry no
// values and every uniform object is shared with `applyLook`.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshBasicMaterial,
} from 'three'
import fragmentParams from '../../assets/blender/cortico/fragment.json' with { type: 'json' }
import manifest from '../../assets/manifest.json' with { type: 'json' }
import { composeMaterial, type Feature } from './composer'
import { groupLift, revealBasic } from './features'
import { heightFogAdditive } from './heightFog'
import { worldPosition } from './worldPosition'

/** A grounded pool spot: centre in metres, radius in metres. */
export interface PoolSpot {
  x: number
  y: number
  z: number
  r: number
}

/** Pool radius, in metres — a lantern's throw on the terrace (fragment.json "pools"). */
export const POOL_RADIUS_M: number = fragmentParams.pools.radius
/** How far above the hit surface a decal floats, in metres (fragment.json "pools"). */
export const POOL_LIFT_M: number = fragmentParams.pools.lift
/** Spacing of pools along a walk line, in metres (fragment.json "pools"). */
export const POOL_SPACING_M: number = fragmentParams.pools.spacing

/** The shared uniforms: zero/black until `applyLook` claims them (inert by day). */
export const lightPoolUniforms = {
  /** The look's night weight; the pools fade in only at night. */
  uPoolNight: { value: 0 },
  /** Warm pool color (palette tangerine), written by `applyLook`. */
  uPoolColor: { value: new Color(0, 0, 0) },
}

/** The radial-falloff power in the shader below, mirrored by `poolFalloff`. */
export const POOL_FALLOFF_POWER = 2.2

/**
 * Pure mirror of the shader below (the foliage precedent): the pool's
 * brightness at quad uv `(u, v)`, 1 at the centre fading to 0 at the rim.
 * Pinned in vitest instead of pixels.
 */
export function poolFalloff(u: number, v: number): number {
  const d = Math.hypot(u - 0.5, v - 0.5) * 2
  return Math.max(1 - d, 0) ** POOL_FALLOFF_POWER
}

/**
 * The pool falloff itself (fol-kes.15): the per-quad uv rides a varying off
 * `begin_vertex`, and the night-weighted warm disc lands on `diffuseColor`
 * for the reveal band to tint and the additive fog to attenuate downstream.
 * Reads no world varying, so it requires nothing — but it always composes
 * after `worldPosition` anyway (see `LIGHT_POOL_FEATURES`), because the
 * reveal and the fog do.
 */
export const lightPool = {
  key: 'light-pool',
  uniforms: lightPoolUniforms,
  vertex: {
    header: /* glsl */ `
      varying vec2 vPoolUv;`,
    chunks: {
      begin_vertex: { after: 'vPoolUv = uv;' },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform vec3 uPoolColor;
      uniform float uPoolNight;
      varying vec2 vPoolUv;`,
    chunks: {
      color_fragment: {
        after: /* glsl */ `
          float poolD = length(vPoolUv - 0.5) * 2.0;
          float poolFall = pow(max(1.0 - poolD, 0.0), ${POOL_FALLOFF_POWER.toFixed(1)});
          diffuseColor.rgb = uPoolColor * (poolFall * uPoolNight);`,
      },
    },
  },
} satisfies Feature

/**
 * The pool program, in composition order: the shared world position first
 * (declares the one varying the reveal and the fog read), the owner's lift,
 * the reveal band, the falloff, and the additive height fog. The composer
 * nests later features closer to the chunk, so the falloff executes before
 * the reveal: the pool lands on `diffuseColor` first and the band tints it
 * (the reverse would let the pool's full assignment wipe the band and
 * light unrevealed terraces at night). The order mirrors the neonGlow shell
 * (`shared.ts`): glow term, reveal tints it, fog attenuates it — except the
 * pool composes by assignment, so it must sit after the reveal in the array
 * where the glow's `*=` can sit before it.
 */
export const LIGHT_POOL_FEATURES = [
  worldPosition,
  groupLift,
  revealBasic,
  lightPool,
  heightFogAdditive,
] as const satisfies readonly Feature[]

/**
 * One composed material for every pool: additive, radial falloff, no depth
 * write, riding group lift, the reveal band and the additive height fog.
 * The base color is black, so a missing falloff term renders nothing under
 * additive blending (inert default, like the zero night weight).
 */
export function createLightPoolMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: new Color(0, 0, 0),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  return composeMaterial(material, [...LIGHT_POOL_FEATURES])
}

/**
 * One merged quad-per-pool geometry on the XZ plane (normal +Y), uv 0..1
 * per quad for the radial falloff, every vertex tagged with the owner's
 * group slot so the lift samples the terrace texel. The slot is required —
 * it is a throwing manifest lookup (`poolOwnerSlot`), so a default would
 * let even `buildLightPoolGeometry([])` throw from a parameter list. Pure,
 * so the layout is pinned in vitest.
 */
export function buildLightPoolGeometry(pools: readonly PoolSpot[], slot: number): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const groupIds: number[] = []
  const indices: number[] = []
  pools.forEach((pool, n) => {
    const base = n * 4
    const { x, y, z, r } = pool
    positions.push(x - r, y, z - r, x + r, y, z - r, x + r, y, z + r, x - r, y, z + r)
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    groupIds.push(slot, slot, slot, slot)
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groupId', new Float32BufferAttribute(groupIds, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The authored pool spots (fol-kes.4, fol-snu.9): parsed out of
 * fragment.pools.only.json, the pools-only sibling the fragment bake writes
 * alongside fragment.pools.json. Fail closed on any drift — a missing or
 * malformed entry throws instead of drawing a half-grounded ring.
 */
export function parseLightPoolLayout(raw: unknown): PoolSpot[] {
  if (typeof raw !== 'object' || raw === null || !('pools' in raw)) {
    throw new Error('lightPool: layout file has no "pools" array')
  }
  const pools = (raw as { pools: unknown }).pools
  if (!Array.isArray(pools)) throw new Error('lightPool: layout "pools" is not an array')
  return pools.map((pool, i) => {
    if (typeof pool !== 'object' || pool === null) {
      throw new Error(`lightPool: pool ${i} is not an object`)
    }
    const { x, y, z, r } = pool as Record<string, unknown>
    if (![x, y, z, r].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error(`lightPool: pool ${i} is not a finite xyzr quad`)
    }
    if ((r as number) <= 0) throw new Error(`lightPool: pool ${i} has a non-positive radius`)
    return { x: x as number, y: y as number, z: z as number, r: r as number }
  })
}

/**
 * The asset whose terraces the pools were authored on (fol-kes.4): the only
 * registration that enables them.
 */
export const POOL_OWNER_ASSET = 'cortico/fragment'

/**
 * The owner group whose lift the pools ride (fol-kes.15): the terraces the
 * spots were authored on. The slot comes from the asset manifest — the same
 * registry the pack remap and the hover writer read — never a literal, so a
 * remap flows through instead of stranding the pools on slot 0 with green
 * tests (the pedestals precedent, fol-ya7).
 */
export const POOL_OWNER_GROUP = 'terrace'

/** The town-wide `uGroupState` slot of the owner's terrace group: throws when unmapped. */
export function poolOwnerSlot(): number {
  const groups = (manifest as Record<string, { groups?: Record<string, number> }>)[POOL_OWNER_ASSET]
    ?.groups
  const slot = groups?.[POOL_OWNER_GROUP]
  if (slot === undefined) {
    throw new Error(
      `lightPool: missing "${POOL_OWNER_ASSET}" group "${POOL_OWNER_GROUP}" in the asset manifest`,
    )
  }
  return slot
}

/**
 * The owner asset's town placement in metres (fol-kes.15): added to every
 * baked spot, so an off-origin fragment carries its pools with it. The
 * fragment bakes at the origin today, so this is identity until the town
 * skeleton's per-hood placement file (fol-l7d.1) feeds it — one helper, read
 * by the mesh position below and mirrored by `applyPoolPlacement`, never a
 * fragment-local assumption scattered through the rig.
 */
export const POOL_OWNER_OFFSET: readonly [number, number, number] = [0, 0, 0]

/**
 * Baked spots carried by the owner placement (fol-kes.15): pure, so the
 * placement math is pinned in vitest instead of pixels. The mesh position
 * does this on the GPU; the mirror proves the numbers.
 */
export function applyPoolPlacement(
  spots: readonly PoolSpot[],
  offset: readonly [number, number, number],
): PoolSpot[] {
  const [ox, oy, oz] = offset
  return spots.map((spot) => ({ ...spot, x: spot.x + ox, y: spot.y + oy, z: spot.z + oz }))
}

/**
 * Whether the owning terraces are registered (fol-kes.4): reads asset
 * membership, never batch names — meadow or forum arriving first share the
 * cream/ground batches but must not enable floating pools. Read live (per
 * frame, like the water pass) — never polled, never waited on.
 */
export function lightPoolsReady(hasAsset: (asset: string) => boolean): boolean {
  return hasAsset(POOL_OWNER_ASSET)
}
