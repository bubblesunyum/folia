// The light-pool decal layout (fol-0sj): geometry builders pinned in vitest
// instead of pixels, plus the shader-inert defaults the daylight capture proves.

import { AdditiveBlending } from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildLightPoolGeometry,
  createLightPoolMaterial,
  lightPoolUniforms,
  POOL_SPACING_M,
  ringWalkLine,
  sampleWalkLine,
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

describe('walk-line sampling (fol-0sj)', () => {
  it('spaces pools along a straight path, keeping the start', () => {
    const pts = sampleWalkLine(
      [
        [0, 0],
        [10, 0],
      ],
      POOL_SPACING_M,
    )
    expect(pts[0]).toEqual([0, 0])
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (!a || !b) continue
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(POOL_SPACING_M, 8)
    }
    const last = pts[pts.length - 1]
    expect(last?.[0]).toBeLessThanOrEqual(10)
  })

  it('carries spacing across joints without duplicating them', () => {
    const pts = sampleWalkLine(
      [
        [0, 0],
        [3.2, 0],
        [3.2, 3.2],
      ],
      POOL_SPACING_M,
    )
    expect(pts).toHaveLength(3)
  })

  it('rings close within one spacing of the start', () => {
    const pts = sampleWalkLine(ringWalkLine([0, 0], 5), POOL_SPACING_M)
    expect(pts.length).toBeGreaterThan(6)
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (!first || !last) throw new Error('no walk samples')
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeLessThan(POOL_SPACING_M)
    for (const [x, z] of pts) {
      // On the polygon chords, so just inside the radius, never outside it.
      expect(Math.hypot(x, z)).toBeGreaterThan(4.9)
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(5)
    }
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
