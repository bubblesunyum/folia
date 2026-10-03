// The light-pool decal layout (fol-0sj): geometry builders pinned in vitest
// instead of pixels, plus the shader-inert defaults the daylight capture proves.

import { AdditiveBlending } from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildLightPoolGeometry,
  createLightPoolMaterial,
  lightPoolsReady,
  lightPoolUniforms,
  POOL_OWNER_ASSET,
  parseLightPoolLayout,
} from './lightPool'

describe('light-pool geometry (fol-0sj)', () => {
  it('merges one flat quad per pool, uv 0..1, normal +Y', () => {
    const geometry = buildLightPoolGeometry([
      { x: 1, y: 2, z: 3, r: 1.5 },
      { x: -4, y: 0.5, z: 0, r: 2 },
    ])
    expect(geometry.index?.count).toBe(12)
    expect(geometry.getAttribute('position').count).toBe(8)
    const pos = geometry.getAttribute('position')
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([-0.5, 2, 1.5])
    const uv = geometry.getAttribute('uv')
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0])
    expect([uv.getX(2), uv.getY(2)]).toEqual([1, 1])
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0])
    }
    expect(geometry.boundingSphere).not.toBeNull()
    geometry.dispose()
  })

  it('builds an empty (but valid) geometry with no pools', () => {
    const geometry = buildLightPoolGeometry([])
    expect(geometry.getAttribute('position').count).toBe(0)
    expect(geometry.index?.count).toBe(0)
    geometry.dispose()
  })
})

describe('authored layout parsing (fol-kes.4)', () => {
  const valid = {
    pools: [
      { x: 1, y: 0.48, z: 2, r: 1.6, level: 0 },
      { x: -3, y: 1.38, z: 1, r: 1.6 },
    ],
  }

  it('passes authored spots through as pool quads', () => {
    expect(parseLightPoolLayout(valid)).toEqual([
      { x: 1, y: 0.48, z: 2, r: 1.6 },
      { x: -3, y: 1.38, z: 1, r: 1.6 },
    ])
  })

  it('fails closed on a missing, shapeless, or non-finite layout', () => {
    expect(() => parseLightPoolLayout(null)).toThrow(/no "pools"/)
    expect(() => parseLightPoolLayout({ pools: 'nope' })).toThrow(/not an array/)
    expect(() => parseLightPoolLayout({ pools: [null] })).toThrow(/not an object/)
    expect(() => parseLightPoolLayout({ pools: [{ x: 1, y: 2, z: 3 }] })).toThrow(/finite xyzr/)
    expect(() => parseLightPoolLayout({ pools: [{ x: 1, y: NaN, z: 3, r: 1.6 }] })).toThrow(
      /finite xyzr/,
    )
    expect(() => parseLightPoolLayout({ pools: [{ x: 1, y: 2, z: 3, r: 0 }] })).toThrow(
      /non-positive radius/,
    )
  })
})

describe('registry readiness gate (fol-kes.4)', () => {
  it('enables pools only once the owning fragment registers', () => {
    expect(lightPoolsReady(() => false)).toBe(false)
    // Meadow or forum arriving first share the batches but own no terraces.
    expect(lightPoolsReady((asset) => asset === 'cortico/meadow')).toBe(false)
    expect(lightPoolsReady((asset) => asset === POOL_OWNER_ASSET)).toBe(true)
  })
})
describe('light-pool material (fol-0sj)', () => {
  it('is additive with no depth write, so decals layer over terraces', () => {
    const material = createLightPoolMaterial()
    expect(material.blending).toBe(AdditiveBlending)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    material.dispose()
  })

  it('shares the inert uniforms: zero night, black color (daylight unchanged)', () => {
    const material = createLightPoolMaterial()
    expect(material.uniforms.uPoolNight).toBe(lightPoolUniforms.uPoolNight)
    expect(material.uniforms.uPoolColor).toBe(lightPoolUniforms.uPoolColor)
    expect(lightPoolUniforms.uPoolNight.value).toBe(0)
    const color = lightPoolUniforms.uPoolColor.value as { r: number; g: number; b: number }
    expect([color.r, color.g, color.b]).toEqual([0, 0, 0])
    material.dispose()
  })
})
