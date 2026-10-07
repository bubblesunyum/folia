// The ripple's ambient-schedule contract (fol-ixw, D-056): the shared clock
// owns `uRippleTime`, the still pose is exactly t = 0, and release parks it
// back there — so still frames sit on the authored water and idle stays green.

import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { AMBIENT_INTERVAL_MS, AmbientScheduler } from '../time/ambient'
import { inject } from './composer'
import {
  RIPPLE_CONSUMER_ID,
  rippleConsumer,
  WATER_ADVECT_AX,
  WATER_ADVECT_AY,
  WATER_ADVECT_BX,
  WATER_ADVECT_BY,
  WATER_OCTAVE_OFFSET,
  WATER_OCTAVE_SCALE,
  WATER_RIPPLE_SCALE,
  WATER_STRETCH_X,
  WATER_STRETCH_Y,
  WATER_TINT_BASE,
  WATER_TINT_GAIN,
  WATER_TINT_HI,
  WATER_TINT_LO,
  water,
  waterTintAt,
} from './water'

describe('ripple uniforms', () => {
  it('parks the time at 0: still renders sit on the authored pose', () => {
    expect(water.uniforms.uRippleTime.value).toBe(0)
  })

  it('keeps the ripple knobs where the look expects them', () => {
    expect(water.uniforms.uDistort.value).toBe(0.008)
    expect(water.uniforms.uRipple.value).toBe(0.14)
    expect(water.uniforms.uRippleScale.value).toBe(WATER_RIPPLE_SCALE)
  })

  it('moves visible pool-teal ridges across the surface as ambient time advances', () => {
    const points = Array.from({ length: 64 }, (_, i) => [i * 0.19, (i % 9) * 0.31] as const)
    const still = points.map(([x, z]) => waterTintAt(x, z, 0))
    const moved = points.map(([x, z]) => waterTintAt(x, z, 2))
    const changed = still.filter((value, i) => Math.abs(value - (moved[i] ?? value)) > 0.08).length
    expect(changed).toBeGreaterThan(8)
  })
})

describe('rippleConsumer', () => {
  it('registers under the ripple id and poses from the shared clock', () => {
    const scheduler = new AmbientScheduler()
    scheduler.register(RIPPLE_CONSUMER_ID, rippleConsumer())
    try {
      expect(scheduler.tick(0, { visible: true, reading: false })).toBe(true)
      expect(water.uniforms.uRippleTime.value).toBe(0)
      expect(scheduler.tick(AMBIENT_INTERVAL_MS, { visible: true, reading: false })).toBe(true)
      expect(water.uniforms.uRippleTime.value).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 9)
      expect(water.uniforms.uRippleTime.value).toBe(scheduler.time)
    } finally {
      scheduler.unregister(RIPPLE_CONSUMER_ID)
    }
  })

  it('releases back to the still pose', () => {
    const scheduler = new AmbientScheduler()
    scheduler.register(RIPPLE_CONSUMER_ID, rippleConsumer())
    scheduler.tick(0, { visible: true, reading: false })
    scheduler.tick(AMBIENT_INTERVAL_MS, { visible: true, reading: false })
    expect(water.uniforms.uRippleTime.value).toBeGreaterThan(0)
    scheduler.unregister(RIPPLE_CONSUMER_ID)
    expect(water.uniforms.uRippleTime.value).toBe(0)
  })

  it('never ticks with the rig unmounted, so idle scenes rest', () => {
    const scheduler = new AmbientScheduler()
    expect(scheduler.tick(10_000, { visible: true, reading: false })).toBe(false)
    expect(water.uniforms.uRippleTime.value).toBe(0)
  })
})

describe('ripple chunks', () => {
  const header = water.fragment?.header as string
  const normal = water.fragment?.chunks?.normal_fragment_maps?.after as string

  it('declares the ambient time and threads it through every height sample', () => {
    expect(header).toContain('uniform float uRippleTime')
    expect(header).toContain('float waterHeight(vec2 p, float t)')
    expect(normal).toContain('waterHeight(rippleAt, uRippleTime)')
  })

  it('advects the octaves against each other, not as one sliding sheet', () => {
    expect(header).toContain(
      `+ vec2(${WATER_ADVECT_AX.toFixed(2)}, ${WATER_ADVECT_AY.toFixed(2)}) * t`,
    )
    expect(header).toContain(
      `- vec2(${WATER_ADVECT_BX.toFixed(2)}, ${WATER_ADVECT_BY.toFixed(2)}) * t`,
    )
  })

  it('builds both octaves from the shared tint constants', () => {
    expect(header).toContain(`vec2(${WATER_STRETCH_X.toFixed(1)}, ${WATER_STRETCH_Y.toFixed(1)})`)
    expect(header).toContain(
      `rippleBase * ${WATER_OCTAVE_SCALE.toFixed(1)} + ${WATER_OCTAVE_OFFSET.toFixed(1)}`,
    )
  })

  it('uses the animated ripple as a restrained visible pool color cue', () => {
    const color = water.fragment?.chunks?.color_fragment?.after as string
    expect(color).toContain('waterHeight(vWaterWorld.xz, uRippleTime)')
    expect(color).toContain(
      `smoothstep(${WATER_TINT_LO.toFixed(2)}, ${WATER_TINT_HI.toFixed(2)}, waterHeight(vWaterWorld.xz, uRippleTime))`,
    )
    expect(color).toContain(
      `diffuseColor.rgb *= ${WATER_TINT_BASE.toFixed(2)} + rippleTint * ${WATER_TINT_GAIN.toFixed(2)}`,
    )
  })

  it('still injects into the real standard program', () => {
    expect(() =>
      inject(structuredClone(ShaderLib.standard.fragmentShader), water.fragment, 'water fragment'),
    ).not.toThrow()
  })
})
