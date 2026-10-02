import { Color, type MeshBasicMaterial, type MeshStandardMaterial } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { palette, signatureColor } from '../palette'
import { lookAt } from '../time/look'
import { bakedLight, foliage, group, reveal } from './features'
import { REVEAL_PARKED_M } from './revealModel'
import { applyLook, materials } from './shared'

// applyLook mutates the shared singletons, so every test leaves the file
// palette behind.
afterEach(() => {
  applyLook(lookAt(18.5), true, palette)
})

describe('applyLook', () => {
  it('paints base colors from the palette and derives neon from the look', () => {
    const look = lookAt(18.5)
    applyLook(look, true, { ...palette, cream: '#123456', mint: '#000000' })
    const cream = materials.cream?.material as MeshStandardMaterial
    expect(cream.color.getHexString()).toBe(new Color('#123456').getHexString())
    const neon = materials.neon?.material as MeshBasicMaterial
    const expected = new Color('#000000').multiplyScalar(look.emissive)
    expect(neon.color.getHexString()).toBe(expected.getHexString())
    expect(bakedLight.uniforms.uNightSpill.value).toBe(look.night)
  })

  it('gives every program the reveal band and the texture-path group state', () => {
    for (const [name, entry] of Object.entries(materials)) {
      const keys = entry.features.map((f) => f.key)
      expect(
        keys.some((k) => k.startsWith('reveal')),
        `${name} has no reveal`,
      ).toBe(true)
      expect(
        keys.some((k) => k.includes('tex')),
        `${name} has no texture-path group`,
      ).toBe(true)
    }
  })

  it('parks the reveal below the town and paints it from the palette', () => {
    applyLook(lookAt(18.5), true, palette)
    expect(reveal.uniforms.uRevealHeight.value).toBe(REVEAL_PARKED_M)
    const cream = reveal.uniforms.uRevealColor.value as Color
    expect(cream.getHexString()).toBe(new Color(palette.cream).getHexString())
  })

  it('drives glow and tint from the neighborhood signature, not a literal', () => {
    applyLook(lookAt(18.5), true, palette)
    const expected = new Color(signatureColor('cortico', palette)).getHexString()
    const glow = group.uniforms.uGroupGlowColor.value as Color
    const tint = group.uniforms.uGroupTintColor.value as Color
    expect(glow.getHexString()).toBe(expected)
    expect(tint.getHexString()).toBe(expected)
  })

  it('fails closed on an unmapped hood instead of falling back to mint', () => {
    expect(() => signatureColor('nowhere', palette)).toThrow()
    expect(() => applyLook(lookAt(18.5), true, palette, 'nowhere')).toThrow()
  })

  it('drives the foliage night spill from the night weight and the signature (fol-2rl)', () => {
    const night = lookAt(22)
    expect(night.night).toBeGreaterThan(0)
    applyLook(night, true, palette)
    expect(foliage.uniforms.uFoliageNight.value).toBe(night.night)
    const spill = foliage.uniforms.uSpillColor.value as Color
    expect(spill.getHexString()).toBe(new Color(signatureColor('cortico', palette)).getHexString())
    const day = lookAt(13)
    applyLook(day, true, palette)
    expect(foliage.uniforms.uFoliageNight.value).toBe(day.night)
  })

  it('composes foliage after the baked spill that declares its varying', () => {
    const keys = materials.foliage?.features.map((f) => f.key) ?? []
    expect(keys.indexOf(bakedLight.key)).toBeLessThan(keys.indexOf('foliage'))
  })

  it('glows each hood its signature color across neon, hover and spill (fol-5co)', () => {
    const look = lookAt(22)
    for (const hood of ['cortico', 'glyphite', 'purple-republic', 'iron-ox']) {
      applyLook(look, true, palette, hood)
      const expected = new Color(signatureColor(hood, palette)).getHexString()
      const neon = materials.neon?.material as MeshBasicMaterial
      const glow = group.uniforms.uGroupGlowColor.value as Color
      const tint = group.uniforms.uGroupTintColor.value as Color
      const spill = foliage.uniforms.uSpillColor.value as Color
      // Neon runs through the emissive multiplier; the rest read the hex.
      expect(neon.color.getHexString()).toBe(
        new Color(signatureColor(hood, palette)).multiplyScalar(look.emissive).getHexString(),
      )
      expect(glow.getHexString()).toBe(expected)
      expect(tint.getHexString()).toBe(expected)
      expect(spill.getHexString()).toBe(expected)
    }
  })

  it('keeps Cortico mint when the scene passes no hood', () => {
    applyLook(lookAt(18.5), true, palette)
    const expected = new Color(signatureColor('cortico', palette)).getHexString()
    const glow = group.uniforms.uGroupGlowColor.value as Color
    expect(glow.getHexString()).toBe(expected)
  })
})
