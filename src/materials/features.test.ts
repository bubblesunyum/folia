// Every composed program injects into its real three shaders: a renamed or
// missing chunk throws here, not as a silently dropped feature in the
// browser. The compositions mirror `shared.ts`; the depth checks ride the
// depth vertex shader the shadow pass actually compiles.

import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { MAX_GROUPS } from '../groupSlots'
import type { Feature } from './composer'
import { inject } from './composer'
import { bakedLight, foliage, group, groupLift, reveal, revealBasic, sway } from './features'
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
