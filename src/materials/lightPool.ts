// Additive light-pool decals (D-038, fol-0sj, fol-kes.4): warm pools of
// lantern light drawn as flat decals on the terrace walk lines, where
// lanterns and paths will go. The spots are authored at bake in
// assets/blender/cortico/fragment.py on the live terrace outlines and read
// from the sibling fragment-layout.json (the forum-layout.json anchor
// precedent) — the runtime only builds the merged quad mesh, never grounds,
// raycasts, or polls. No lantern geometry exists yet, so these baked spots
// stand in for the future lantern/planter spill until the fragment models them.
//
// One draw call: every pool is a quad in a single BufferGeometry sharing one
// ShaderMaterial. No new lights (D-038's fixed light count is untouched), no
// selective-bloom passes. Daylight inert: opacity rides the night weight
// (zero by day) and the component hides the mesh until night.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  ShaderMaterial,
} from 'three'
import fragmentParams from '../../assets/blender/cortico/fragment.json' with { type: 'json' }

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

/** One ShaderMaterial for every pool: additive, radial falloff, no depth write. */
export function createLightPoolMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: lightPoolUniforms,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vPoolUv;
      void main() {
        vPoolUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPoolColor;
      uniform float uPoolNight;
      varying vec2 vPoolUv;
      void main() {
        float d = length(vPoolUv - 0.5) * 2.0;
        float fall = pow(max(1.0 - d, 0.0), 2.2);
        gl_FragColor = vec4(uPoolColor * (fall * uPoolNight), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  return material
}

/**
 * One merged quad-per-pool geometry on the XZ plane (normal +Y), uv 0..1 per
 * quad for the radial falloff. Pure, so the layout is pinned in vitest.
 */
export function buildLightPoolGeometry(pools: readonly PoolSpot[]): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  pools.forEach((pool, n) => {
    const base = n * 4
    const { x, y, z, r } = pool
    positions.push(x - r, y, z - r, x + r, y, z - r, x + r, y, z + r, x - r, y, z + r)
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The authored pool spots (fol-kes.4): parsed out of fragment-layout.json,
 * the file the fragment bake writes. Fail closed on any drift — a missing or
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
 * Whether the owning terraces are registered (fol-kes.4): reads asset
 * membership, never batch names — meadow or forum arriving first share the
 * cream/ground batches but must not enable floating pools. Read live (per
 * frame, like the water pass) — never polled, never waited on.
 */
export function lightPoolsReady(hasAsset: (asset: string) => boolean): boolean {
  return hasAsset(POOL_OWNER_ASSET)
}
