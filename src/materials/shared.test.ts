import { Color, type MeshBasicMaterial, type MeshStandardMaterial } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { palette, signatureColor } from '../palette'
import { lookAt } from '../time/look'
import { bakedLight, group, reveal } from './features'
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
    expect(() => signatureColor('glyphite', palette)).toThrow()
  })
})
