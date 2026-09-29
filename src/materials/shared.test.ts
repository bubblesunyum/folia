import { Color, type MeshBasicMaterial, type MeshStandardMaterial } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { palette } from '../palette'
import { lookAt } from '../time/look'
import { bakedLight } from './features'
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
})
