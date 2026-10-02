// Every composed program injects into its real three shaders: a renamed or
// missing chunk throws here, not as a silently dropped feature in the
// browser. The compositions mirror `shared.ts`; the depth checks ride the
// depth vertex shader the shadow pass actually compiles.

import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { MAX_GROUPS } from '../groupSlots'
import type { Feature } from './composer'
import { inject } from './composer'
import {
  bakedLight,
  FOLIAGE_THIN_FALLOFF,
  foliage,
  foliageBacklit,
  foliageThin,
  group,
  groupLift,
  reveal,
  revealBasic,
  sway,
} from './features'
import { neonGlow } from './neonGlow'
import { water } from './water'

interface ProgramShaders {
  vertexShader: string
  fragmentShader: string
}

/** Injects `feature`'s stages into `program` (plus the depth vertex when it has one). */
function check(feature: Feature, program: ProgramShaders, label: string): void {
  if (feature.vertex) inject(program.vertexShader, feature.vertex, `${label} vertex`)
  if (feature.fragment) inject(program.fragmentShader, feature.fragment, `${label} fragment`)
  if (feature.depthVertex) {
    inject(ShaderLib.depth.vertexShader, feature.depthVertex, `${label} depth`)
  }
}

describe('feature injection against three shaders', () => {
  it('puts the lit program (baked, group, reveal) on MeshStandardMaterial', () => {
    for (const feature of [bakedLight, group, reveal]) {
      expect(() => check(feature, ShaderLib.standard, feature.key)).not.toThrow()
    }
  })

  it('puts foliage and sway on the standard program too', () => {
    for (const feature of [foliage, sway]) {
      expect(() => check(feature, ShaderLib.standard, feature.key)).not.toThrow()
    }
  })

  it('puts lift and the basic reveal on MeshBasicMaterial (neon)', () => {
    for (const feature of [groupLift, revealBasic]) {
      expect(() => check(feature, ShaderLib.basic, feature.key)).not.toThrow()
    }
  })

  it('puts the glow shell on the basic program with the lift', () => {
    expect(() => check(neonGlow, ShaderLib.basic, neonGlow.key)).not.toThrow()
  })

  it('puts water and the full reveal on the standard program', () => {
    for (const feature of [groupLift, water, reveal]) {
      expect(() => check(feature, ShaderLib.standard, feature.key)).not.toThrow()
    }
  })

  it('carries every vertex motion (lift, sway) in the depth vertex shader', () => {
    for (const feature of [group, groupLift, sway]) {
      expect(feature.depthVertex).toBeDefined()
      expect(() =>
        inject(ShaderLib.depth.vertexShader, feature.depthVertex, `${feature.key} depth`),
      ).not.toThrow()
    }
  })

  it('keeps the reveal out of depth: the band moves no vertices', () => {
    const bands: Feature[] = [reveal, revealBasic]
    for (const band of bands) {
      expect(band.depthVertex).toBeUndefined()
    }
  })
})

describe('texture-path cutover', () => {
  it('keys the group programs on the texture path, not the uniform-array era', () => {
    expect(group.key).not.toBe('group')
    expect(groupLift.key).not.toBe('group-lift')
    expect(group.key).toContain('tex')
    expect(groupLift.key).toContain('tex')
  })

  it('indexes the texture by the shared slot width', () => {
    expect(group.vertex?.chunks?.begin_vertex?.after).toContain(`float(${MAX_GROUPS})`)
  })

  it('samples one shared texture from lift and full programs alike', () => {
    expect(groupLift.uniforms?.uGroupState).toBe(group.uniforms?.uGroupState)
  })

  it('drives both reveal variants from one set of uniforms', () => {
    expect(revealBasic.uniforms?.uRevealHeight).toBe(reveal.uniforms?.uRevealHeight)
    expect(revealBasic.uniforms?.uRevealColor).toBe(reveal.uniforms?.uRevealColor)
  })
})

describe('foliage back-light curve (fol-rzn, fol-bv8)', () => {
  const lightsEnd = foliage.fragment?.chunks?.lights_fragment_end?.after as string

  it('shapes the view-to-sun alignment by the power, saturating like the shader', () => {
    expect(foliageBacklit(1, 3)).toBe(1)
    expect(foliageBacklit(0, 3)).toBe(0)
    expect(foliageBacklit(-0.5, 3)).toBe(0)
    expect(foliageBacklit(1.5, 3)).toBe(1)
    expect(foliageBacklit(0.5, 3)).toBeCloseTo(0.125, 10)
  })

  it('reads sun-facing leaves thick and edges thin', () => {
    expect(foliageThin(1)).toBeCloseTo(1 - FOLIAGE_THIN_FALLOFF, 10)
    expect(foliageThin(0)).toBe(1)
    expect(foliageThin(-1)).toBe(1)
  })

  it('runs the retuned live curve: stronger, wider, thinner floor (fol-bv8)', () => {
    expect(FOLIAGE_THIN_FALLOFF).toBe(0.45)
    expect(foliage.uniforms?.uTranslucency?.value).toBe(1.2)
    expect(foliage.uniforms?.uTranslucencyPower?.value).toBe(2)
    // Sun-far edges at full alignment stay well above the old response
    // (0.9 * 1^3 * 1 = 0.9) without washing out: the term still needs the
    // view ray aimed at the sun.
    expect(1.2 * foliageBacklit(1, 2) * foliageThin(0)).toBeGreaterThan(0.9)
    expect(1.2 * foliageBacklit(0.5, 2) * foliageThin(0)).toBeLessThan(0.35)
  })

  it('gates the back-light term by the sun shadow, leaving wrap unshadowed', () => {
    expect(lightsEnd).toContain('directionalShadowMap[ 0 ]')
    expect(lightsEnd).toContain('vDirectionalShadowCoord[ 0 ]')
    expect(lightsEnd).toContain('receiveShadow')
    expect(lightsEnd).toContain('sunShadow * uTranslucency * backLit * thin')
    // Wrap stays unshadowed: only the translucency term takes the gate.
    expect(lightsEnd).toContain('(wrapped + sunShadow')
  })

  it('falls back to full sun when the shadow map is off', () => {
    expect(lightsEnd).toContain('float sunShadow = 1.0;')
    expect(lightsEnd).toContain('#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0')
  })

  it('keeps the shader thin falloff on the tested constant', () => {
    expect(lightsEnd).toContain(`1.0 - ${FOLIAGE_THIN_FALLOFF.toFixed(2)} * saturate(ndl)`)
  })

  it('spills neon on near-neon leaves through emissive, inert by day (fol-2rl)', () => {
    const emissive = foliage.fragment?.chunks?.emissivemap_fragment?.after as string
    expect(emissive).toContain('vBakedNight')
    expect(emissive).toContain('uFoliageNight')
    expect(emissive).toContain('uSpillColor')
    expect(emissive).toContain('totalEmissiveRadiance +=')
    expect(foliage.uniforms?.uFoliageNight?.value).toBe(0)
    const spill = foliage.uniforms?.uSpillColor?.value as { r: number; g: number; b: number }
    expect([spill.r, spill.g, spill.b]).toEqual([0, 0, 0])
  })
})
