// Additive light-pool decals (D-038, fol-0sj): warm pools of lantern light
// drawn as flat decals along the terrace walk lines, where lanterns and paths
// will go. No lantern geometry exists yet, so one merged quad mesh grounded by
// raycast at runtime (see scene/LightPools.tsx) stands in for the future
// lantern/planter spill until the fragment models them.
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

/** A grounded pool spot: centre in metres, radius in metres. */
export interface PoolSpot {
  x: number
  y: number
  z: number
  r: number
}

/** Default pool radius, in metres — a lantern's throw on the terrace. */
export const POOL_RADIUS_M = 1.6
/** How far above the hit surface a decal floats, in metres. */
export const POOL_LIFT_M = 0.03
/** Spacing of pools along a walk line, in metres. */
export const POOL_SPACING_M = 3.2

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

/** A walk line in plan view: the polyline the pools follow. */
export type WalkLine = readonly (readonly [number, number])[]

/**
 * Resamples a walk-line polyline at `spacingM`, returning plan-view pool
 * centres (start point included, no duplicate joints). Pure, pinned in vitest.
 */
export function sampleWalkLine(line: WalkLine, spacingM: number): [number, number][] {
  const out: [number, number][] = []
  if (line.length === 0) return out
  const first = line[0]
  if (!first) return out
  out.push([first[0], first[1]])
  let acc = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    if (!a || !b) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    let travelled = spacingM - acc
    while (travelled <= len) {
      const t = travelled / len
      out.push([a[0] + dx * t, a[1] + dz * t])
      travelled += spacingM
    }
    acc = (acc + len) % spacingM
  }
  return out
}

/** A ring walk line around `center` at radius `r`, closed. */
export function ringWalkLine(
  center: readonly [number, number],
  r: number,
  segments = 24,
): WalkLine {
  const pts: [number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r])
  }
  return pts
}
