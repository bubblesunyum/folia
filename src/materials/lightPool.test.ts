// The light-pool decal layout (fol-0sj): geometry builders pinned in vitest
// instead of pixels, plus the shader-inert defaults the daylight capture proves.
// fol-kes.15: the quads carry the terrace slot (group lift), the falloff
// mirrors the shader, and the program composes lift + reveal + additive fog.

import { AdditiveBlending, ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import manifest from '../../assets/manifest.json' with { type: 'json' }
import { composeMaterial, type Feature, inject } from './composer'
import { groupLift, revealBasic } from './features'
import { heightFogAdditive } from './heightFog'
import {
  applyPoolPlacement,
  buildLightPoolGeometry,
  createLightPoolMaterial,
  LIGHT_POOL_FEATURES,
  lightPool,
  lightPoolsReady,
  lightPoolUniforms,
  POOL_FALLOFF_POWER,
  POOL_OWNER_ASSET,
  POOL_OWNER_GROUP,
  POOL_OWNER_OFFSET,
  parseLightPoolLayout,
  poolFalloff,
  poolOwnerSlot,
} from './lightPool'

describe('light-pool geometry (fol-0sj)', () => {
  it('merges one flat quad per pool, uv 0..1, normal +Y', () => {
    const geometry = buildLightPoolGeometry(
      [
        { x: 1, y: 2, z: 3, r: 1.5 },
        { x: -4, y: 0.5, z: 0, r: 2 },
      ],
      4,
    )
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
    const geometry = buildLightPoolGeometry([], 4)
    expect(geometry.getAttribute('position').count).toBe(0)
    expect(geometry.index?.count).toBe(0)
    geometry.dispose()
  })

  it('tags every pool vertex with the owner slot, so the lift samples the terrace texel (fol-kes.15)', () => {
    const geometry = buildLightPoolGeometry(
      [
        { x: 1, y: 2, z: 3, r: 1.5 },
        { x: -4, y: 0.5, z: 0, r: 2 },
      ],
      7,
    )
    const group = geometry.getAttribute('groupId')
    expect(group.count).toBe(8)
    for (let i = 0; i < group.count; i++) {
      expect(group.getX(i)).toBe(7)
    }
    geometry.dispose()
  })

  it('takes the owner terrace slot from the manifest (fol-kes.15)', () => {
    const geometry = buildLightPoolGeometry([{ x: 0, y: 0, z: 0, r: 1 }], poolOwnerSlot())
    expect(geometry.getAttribute('groupId').getX(0)).toBe(poolOwnerSlot())
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

describe('owner slot and placement (fol-kes.15)', () => {
  it('resolves the terrace slot from the manifest, never a literal', () => {
    const groups = (manifest as Record<string, { groups: Record<string, number> }>)[
      POOL_OWNER_ASSET
    ]?.groups
    expect(groups?.[POOL_OWNER_GROUP]).toBeDefined()
    expect(poolOwnerSlot()).toBe(groups?.[POOL_OWNER_GROUP])
  })

  it('parks the owner offset at the origin until the town skeleton places the fragment', () => {
    expect([...POOL_OWNER_OFFSET]).toEqual([0, 0, 0])
  })

  it('carries baked spots by the owner placement', () => {
    const spots = [{ x: 1, y: 0.48, z: 2, r: 1.6 }]
    expect(applyPoolPlacement(spots, [10, 0, -4])).toEqual([{ x: 11, y: 0.48, z: -2, r: 1.6 }])
    // Identity today: the mesh position this mirrors leaves spots untouched.
    expect(applyPoolPlacement(spots, POOL_OWNER_OFFSET)).toEqual(spots)
  })
})

describe('pool falloff mirror (fol-kes.15)', () => {
  it('is full at the centre and gone at the rim and corners', () => {
    expect(poolFalloff(0.5, 0.5)).toBe(1)
    expect(poolFalloff(0, 0.5)).toBe(0)
    expect(poolFalloff(0, 0)).toBe(0)
    expect(poolFalloff(0.5, 0.75)).toBeCloseTo(0.5 ** POOL_FALLOFF_POWER, 10)
  })

  it('keeps the shader on the tested power', () => {
    const color = lightPool.fragment?.chunks?.color_fragment?.after as string
    expect(color).toContain(`pow(max(1.0 - poolD, 0.0), ${POOL_FALLOFF_POWER.toFixed(1)})`)
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
describe('light-pool material (fol-0sj, fol-kes.15)', () => {
  it('is additive with no depth write, so decals layer over terraces', () => {
    const material = createLightPoolMaterial()
    expect(material.blending).toBe(AdditiveBlending)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    material.dispose()
  })

  it('shares the inert uniforms: zero night, black color (daylight unchanged)', () => {
    const material = createLightPoolMaterial()
    expect(lightPool.uniforms.uPoolNight).toBe(lightPoolUniforms.uPoolNight)
    expect(lightPool.uniforms.uPoolColor).toBe(lightPoolUniforms.uPoolColor)
    expect(lightPoolUniforms.uPoolNight.value).toBe(0)
    const color = lightPoolUniforms.uPoolColor.value as { r: number; g: number; b: number }
    expect([color.r, color.g, color.b]).toEqual([0, 0, 0])
    material.dispose()
  })

  it('composes lift, reveal and additive fog behind the shared world position', () => {
    const material = createLightPoolMaterial()
    const key = material.customProgramCacheKey?.() ?? ''
    for (const part of [
      'world-position',
      groupLift.key,
      'light-pool',
      revealBasic.key,
      heightFogAdditive.key,
    ]) {
      expect(key).toContain(part)
    }
    material.dispose()
  })

  it('injects every pool feature into the real basic shaders', () => {
    const features: Feature[] = [...LIGHT_POOL_FEATURES]
    for (const feature of features) {
      expect(() =>
        inject(structuredClone(ShaderLib.basic.vertexShader), feature.vertex, 'pool vertex'),
      ).not.toThrow()
      expect(() =>
        inject(structuredClone(ShaderLib.basic.fragmentShader), feature.fragment, 'pool fragment'),
      ).not.toThrow()
    }
  })

  it('orders the reveal band before the falloff, so the band tints the pools (fol-kes.15)', () => {
    const names = LIGHT_POOL_FEATURES.map((f) => f.key)
    expect(names.indexOf(revealBasic.key)).toBeLessThan(names.indexOf(lightPool.key))
  })

  it('executes the pool falloff before the reveal mix in the composed shader', () => {
    const features: Feature[] = [...LIGHT_POOL_FEATURES]
    let src = ShaderLib.basic.fragmentShader
    for (const feature of features) {
      src = inject(src, feature.fragment, 'pool order')
    }
    const poolAt = src.indexOf('uPoolColor *')
    const revealAt = src.indexOf('revealMix(vSharedWorld.y)')
    expect(poolAt).toBeGreaterThan(-1)
    expect(revealAt).toBeGreaterThan(-1)
    // The pool's full assignment must land first; the reveal mix then tints
    // it, instead of the assignment wiping the band on unrevealed terraces.
    expect(poolAt).toBeLessThan(revealAt)
  })

  it('throws when a required feature is missing instead of emitting bad GLSL', () => {
    expect(() => composeMaterial(createLightPoolMaterial(), [revealBasic])).toThrow(
      'requires world-position',
    )
  })
})
