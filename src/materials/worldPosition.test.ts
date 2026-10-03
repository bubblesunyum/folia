// One shared world-position varying (fol-kes.7): the transform order, the
// deformed-vertex read, the single declaration per program, and injection
// into the real lit and basic/additive shaders.

import { MeshStandardMaterial, ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { composeMaterial, type Feature, inject } from './composer'
import { foliage, reveal, revealBasic } from './features'
import { heightFog, heightFogAdditive } from './heightFog'
import { materials } from './shared'
import { windowBands } from './windowBands'
import { WORLD_POSITION_VARYING, worldPosition } from './worldPosition'

/** The vertex assignment, in order, like `install` applies it. */
function composedVertex(features: readonly Feature[]): string {
  let out = ShaderLib.standard.vertexShader
  for (const f of features) out = inject(out, f.vertex, `${f.key} vertex`)
  return out
}

/** The fragment source, in order, like `install` applies it. */
function composedFragment(features: readonly Feature[]): string {
  let out = ShaderLib.standard.fragmentShader
  for (const f of features) out = inject(out, f.fragment, `${f.key} fragment`)
  return out
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('world-position transform (fol-kes.7)', () => {
  const after = worldPosition.vertex?.chunks?.worldpos_vertex?.after as string

  it('reads the deformed vertex, so lift and sway stay coherent', () => {
    expect(after).toContain('vec4(transformed, 1.0)')
    expect(after).not.toContain('position.y')
    expect(after).not.toContain('= position;')
  })

  it('walks batch -> instance -> model, mirroring three', () => {
    const t = after.indexOf('transformed')
    const batch = after.indexOf('batchingMatrix')
    const instance = after.indexOf('instanceMatrix')
    const model = after.indexOf('modelMatrix')
    expect(t).toBeGreaterThanOrEqual(0)
    expect(batch).toBeGreaterThan(t)
    expect(instance).toBeGreaterThan(batch)
    expect(model).toBeGreaterThan(instance)
    expect(after).toContain('vSharedWorld = (modelMatrix * sharedWorldPos).xyz;')
  })

  it("never collides with three's own worldPosition local", () => {
    expect(after).not.toMatch(/vec4\s+worldPosition\b/)
    expect(worldPosition.vertex?.header).not.toContain('sharedWorldPos')
  })

  it('declares one varying shared by both stages', () => {
    expect(worldPosition.vertex?.header).toBe(`varying vec3 ${WORLD_POSITION_VARYING};`)
    expect(worldPosition.fragment?.header).toBe(`varying vec3 ${WORLD_POSITION_VARYING};`)
    expect(WORLD_POSITION_VARYING).toBe('vSharedWorld')
  })

  it('injects into the real standard and basic shaders, vertex and fragment', () => {
    for (const [program, label] of [
      [ShaderLib.standard, 'standard'],
      [ShaderLib.basic, 'basic'],
    ] as const) {
      expect(() =>
        inject(structuredClone(program.vertexShader), worldPosition.vertex, `${label} vertex`),
      ).not.toThrow()
      expect(() =>
        inject(
          structuredClone(program.fragmentShader),
          worldPosition.fragment,
          `${label} fragment`,
        ),
      ).not.toThrow()
    }
  })

  it('stays out of depth and keys value-free, so shadows and time never move', () => {
    expect((worldPosition as Feature).depthVertex).toBeUndefined()
    expect(worldPosition.key).toBe('world-position')
  })
})

describe('one declaration per program (fol-kes.7)', () => {
  const consumers: Feature[] = [
    heightFog,
    heightFogAdditive,
    windowBands,
    reveal,
    revealBasic,
    foliage,
  ]

  it('consumers declare no world varying of their own', () => {
    for (const feature of consumers) {
      expect(feature.vertex, `${feature.key} keeps a vertex stage`).toBeUndefined()
      expect(feature.fragment?.header, `${feature.key} declares a varying`).not.toContain(
        'varying vec3',
      )
      expect(feature.fragment?.header, `${feature.key} declares a varying`).not.toContain(
        'varying float',
      )
    }
  })

  it('consumers require the shared feature instead of composing alone', () => {
    for (const feature of consumers) {
      expect(feature.requires, `${feature.key} has no requirement`).toContain('world-position')
    }
    expect(() => composeMaterial(new MeshStandardMaterial(), [heightFog])).toThrow(
      'height-fog requires world-position',
    )
  })

  it('composes to exactly one varying declaration with no legacy varyings', () => {
    // heightFog and heightFogAdditive never share a program (both replace
    // fog_fragment), so each gets its own composition.
    const groups = [
      [worldPosition, heightFog, windowBands, reveal, foliage],
      [worldPosition, heightFogAdditive, revealBasic],
    ] as const
    for (const group of groups) {
      const vertex = composedVertex(group)
      const fragment = composedFragment(group)
      expect(occurrences(vertex, 'varying vec3 vSharedWorld;')).toBe(1)
      expect(occurrences(fragment, 'varying vec3 vSharedWorld;')).toBe(1)
      for (const legacy of ['vFogWorld', 'vWindowWorld', 'vFoliageWorld', 'vRevealY']) {
        expect(vertex, `vertex still mentions ${legacy}`).not.toContain(legacy)
        expect(fragment, `fragment still mentions ${legacy}`).not.toContain(legacy)
      }
    }
  })

  it('no consumer treats a local position as world', () => {
    const vertex = composedVertex([worldPosition, ...consumers])
    expect(vertex).not.toContain('vWindowWorld = position')
    expect(vertex).not.toContain('vRevealY = position.y')
  })

  it('every shared material composes the feature exactly once', () => {
    for (const [name, entry] of Object.entries(materials)) {
      const count = entry.features.filter((f) => f.key === 'world-position').length
      expect(count, `${name} composes world-position ${count}x`).toBe(1)
      expect(entry.features[0]?.key, `${name} declares it first`).toBe('world-position')
    }
  })

  it('keeps the shared varying out of every depth program', () => {
    for (const [name, entry] of Object.entries(materials)) {
      const key = entry.depth.customProgramCacheKey?.() ?? ''
      expect(key, `${name} depth carries world-position`).not.toContain('world-position')
    }
  })
})
