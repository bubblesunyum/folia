// Height fog (D-046, fol-snu.4): the pure factor against a stable reference,
// injection into the real three shaders, and color-only shared coverage.

import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { palette } from '../palette'
import { lookAt } from '../time/look'
import { type Feature, inject } from './composer'
import { heightFog, heightFogAdditive, heightFogFactor } from './heightFog'
import { applyLook, materials } from './shared'
import { SKY_GRADIENT_GLSL, skyGradientUniforms } from './skyGradient'

/** Branch-free reference via expm1, stable for tiny rays. */
function reference(
  dist: number,
  eyeAbove: number,
  dy: number,
  density: number,
  falloff: number,
): number {
  const x = falloff * dy
  const avg = Math.abs(x) < 1e-12 ? 1 : -Math.expm1(-x) / x
  return 1 - Math.exp(-density * dist * Math.exp(-falloff * eyeAbove) * avg)
}

describe('heightFogFactor', () => {
  it('reads zero with zero density, whatever the geometry', () => {
    const cases: Array<[number, number, number, number]> = [
      [120, 0, 0, 0.06],
      [120, -50, -30, 0.06],
      [2000, 500, 400, 0.5],
      [0, 0, 0, 0.06],
    ]
    for (const [dist, eyeAbove, dy, falloff] of cases) {
      expect(heightFogFactor(dist, eyeAbove, dy, 0, falloff)).toBe(0)
    }
  })

  it('recovers pure exponential distance fog at zero falloff', () => {
    for (const dist of [0, 10, 120, 800]) {
      expect(heightFogFactor(dist, 3, 7, 0.004, 0)).toBeCloseTo(1 - Math.exp(-0.004 * dist), 12)
    }
  })

  it('matches the stable reference across horizontal, downward and upward rays', () => {
    for (const eyeAbove of [-50, -5, 0, 3, 50]) {
      for (const dy of [0, 1e-6, 1e-4, 1e-3, 0.05, 1, 10, 100, -0.05, -10, -100]) {
        expect(heightFogFactor(120, eyeAbove, dy, 0.004, 0.06)).toBeCloseTo(
          reference(120, eyeAbove, dy, 0.004, 0.06),
          6,
        )
      }
    }
  })

  it('stays in [0, 1] with no NaN at extreme altitudes and ranges', () => {
    for (const eyeAbove of [-500, 500]) {
      for (const dy of [-500, 0, 500]) {
        for (const dist of [0, 1, 500, 2000]) {
          const f = heightFogFactor(dist, eyeAbove, dy, 0.004, 0.06)
          expect(Number.isNaN(f)).toBe(false)
          expect(f).toBeGreaterThanOrEqual(0)
          // Deep in the layer at long range the ray saturates to full fog.
          expect(f).toBeLessThanOrEqual(1)
        }
      }
    }
    // Ordinary ranges never fully fog out.
    expect(heightFogFactor(200, 0, 0, 0.004, 0.06)).toBeLessThan(1)
  })

  it('grows with distance, thins above the base, thickens below it', () => {
    const near = heightFogFactor(10, 0, 0, 0.004, 0.06)
    const far = heightFogFactor(200, 0, 0, 0.004, 0.06)
    expect(far).toBeGreaterThan(near)
    const above = heightFogFactor(120, 40, 0, 0.004, 0.06)
    const atBase = heightFogFactor(120, 0, 0, 0.004, 0.06)
    const below = heightFogFactor(120, -20, 0, 0.004, 0.06)
    expect(atBase).toBeGreaterThan(above)
    expect(below).toBeGreaterThan(atBase)
  })

  it('fogs a downward ray into the layer harder than the same upward ray', () => {
    const down = heightFogFactor(120, 30, -30, 0.004, 0.06)
    const up = heightFogFactor(120, 30, 30, 0.004, 0.06)
    expect(down).toBeGreaterThan(up)
  })

  it('holds the horizontal ray stable at the branch boundary', () => {
    const at = heightFogFactor(120, 3, 0, 0.004, 0.06)
    const near = heightFogFactor(120, 3, 1e-4, 0.004, 0.06)
    expect(near).toBeCloseTo(at, 5)
    expect(at).toBeCloseTo(reference(120, 3, 0, 0.004, 0.06), 9)
  })
})

describe('height-fog injection', () => {
  it('injects into the real standard and basic shaders', () => {
    for (const [program, label] of [
      [ShaderLib.standard, 'standard'],
      [ShaderLib.basic, 'basic'],
    ] as const) {
      expect(() => inject(program.vertexShader, heightFog.vertex, `${label} vertex`)).not.toThrow()
      expect(() =>
        inject(program.fragmentShader, heightFog.fragment, `${label} fragment`),
      ).not.toThrow()
      expect(() =>
        inject(program.fragmentShader, heightFogAdditive.fragment, `${label} additive fragment`),
      ).not.toThrow()
    }
  })

  it('tints toward the directional sky gradient before output, never after', () => {
    const before = heightFog.fragment?.chunks?.opaque_fragment?.before as string
    expect(before).toContain('outgoingLight')
    expect(before).toContain('skyGradientColor')
    expect(before).toContain('vFogWorld - cameraPosition')
    expect(before).toContain('heightFogAmount')
    // The stock distance fog must not run as well: replaced with nothing.
    expect(heightFog.fragment?.chunks?.fog_fragment?.instead).toBe('')
    // No flat fog color: the gradient owns the tint.
    expect(heightFog.fragment?.header).not.toContain('uFogColor')
    expect(heightFog.fragment?.header).toContain('skyGradientColor')
  })

  it('shares the sky gradient GLSL with the background', () => {
    expect(heightFog.fragment?.header).toContain('skyGradientColor(vec3 d)')
    expect(SKY_GRADIENT_GLSL).toContain('skyGradientColor(vec3 d)')
  })

  it('attenuates additive shells toward black instead of tinting', () => {
    const before = heightFogAdditive.fragment?.chunks?.opaque_fragment?.before as string
    expect(before).toContain('outgoingLight *= 1.0 - heightFogAmount(vFogWorld)')
    expect(before).not.toContain('skyGradientColor')
    expect(heightFogAdditive.fragment?.header).not.toContain('skyGradientColor')
    expect(heightFogAdditive.fragment?.header).not.toContain('uFogColor')
    expect(heightFogAdditive.fragment?.chunks?.fog_fragment?.instead).toBe('')
  })

  it('rides the deformed batch/instance world position and the eye position', () => {
    const vertex = heightFog.vertex?.chunks?.worldpos_vertex?.after as string
    expect(vertex).toContain('transformed')
    expect(vertex).toContain('batchingMatrix')
    expect(vertex).toContain('instanceMatrix')
    expect(vertex).toContain('modelMatrix')
    // Same world path for the additive shell, so lift and sway stay coherent.
    const additiveVertex = heightFogAdditive.vertex?.chunks?.worldpos_vertex?.after as string
    expect(additiveVertex).toContain('transformed')
    expect(additiveVertex).toContain('batchingMatrix')
    expect(additiveVertex).toContain('instanceMatrix')
    // The factor reads the eye height and the fragment height off the ray.
    expect(heightFog.fragment?.header).toContain('cameraPosition')
    expect(heightFog.fragment?.header).toContain('uFogHeightFalloff')
    expect(heightFog.fragment?.header).toContain('uFogBaseHeight')
    expect(heightFog.fragment?.header).toContain('uFogDensity')
  })

  it('stays out of depth: fog is color only', () => {
    expect((heightFog as Feature).depthVertex).toBeUndefined()
    expect((heightFogAdditive as Feature).depthVertex).toBeUndefined()
  })

  it('keys programs on value-free keys, so time never recompiles', () => {
    expect(heightFog.key).toBe('height-fog')
    expect(heightFogAdditive.key).toBe('height-fog-additive')
  })

  it('starts inert: zero density reads exactly unchanged', () => {
    expect(heightFog.uniforms?.uFogDensity?.value).toBe(0)
    expect(heightFogAdditive.uniforms?.uFogDensity?.value).toBe(0)
  })
})

describe('height-fog shared coverage', () => {
  it('composes height fog into every shared material and disables built-in fog', () => {
    for (const [name, entry] of Object.entries(materials)) {
      const keys = entry.features.map((f) => f.key)
      const hasFog = keys.includes('height-fog') || keys.includes('height-fog-additive')
      expect(hasFog, `${name} has no height fog`).toBe(true)
      const fog = (entry.material as unknown as { fog?: boolean }).fog
      expect(fog, `${name} would double-apply stock fog`).toBe(false)
    }
  })

  it('fogs ordinary shells toward the sky, the additive glow toward black', () => {
    for (const name of ['cream', 'gold', 'ground', 'foliage', 'neon', 'water']) {
      const keys = materials[name]?.features.map((f) => f.key) ?? []
      expect(keys, `${name} should tint toward the sky`).toContain('height-fog')
      expect(keys, `${name} should not attenuate`).not.toContain('height-fog-additive')
    }
    const glowKeys = materials.neonGlow?.features.map((f) => f.key) ?? []
    expect(glowKeys).toContain('height-fog-additive')
    expect(glowKeys).not.toContain('height-fog')
  })

  it('keeps height fog out of every depth program', () => {
    for (const [name, entry] of Object.entries(materials)) {
      const key = entry.depth.customProgramCacheKey?.() ?? ''
      expect(key, `${name} depth carries fog`).not.toContain('height-fog')
    }
  })

  it('drives the shared density trio from the look, so scrubbing updates pixels', () => {
    const day = lookAt(13)
    applyLook(day, true, palette)
    expect(heightFog.uniforms?.uFogDensity?.value).toBe(day.fog.density)
    expect(heightFog.uniforms?.uFogHeightFalloff?.value).toBe(day.fog.heightFalloff)
    expect(heightFog.uniforms?.uFogBaseHeight?.value).toBe(day.fog.baseHeight)
    // One shared trio: the additive shell reads the same objects.
    expect(heightFogAdditive.uniforms?.uFogDensity).toBe(
      (heightFog.uniforms as Record<string, unknown>)?.uFogDensity,
    )
    const night = lookAt(22)
    applyLook(night, true, palette)
    expect(heightFog.uniforms?.uFogDensity?.value).toBe(night.fog.density)
    expect(heightFogAdditive.uniforms?.uFogDensity?.value).toBe(night.fog.density)
    applyLook(lookAt(18.5), true, palette)
  })

  it('paints the shared sky from the same look + sun as the background', () => {
    const look = lookAt(18.5)
    const sun = [0.3, 0.8, 0.5] as const
    applyLook(look, true, palette, 'cortico', sun)
    expect(skyGradientUniforms.uZenith.value.toArray()).toEqual(Array.from(look.sky.zenith))
    expect(skyGradientUniforms.uHorizon.value.toArray()).toEqual(Array.from(look.sky.horizon))
    expect(skyGradientUniforms.uSunDirection.value.toArray()).toEqual(Array.from(sun))
    expect(skyGradientUniforms.uGlowIntensity.value).toBe(look.sky.glowIntensity)
    applyLook(lookAt(18.5), true, palette)
  })
})
