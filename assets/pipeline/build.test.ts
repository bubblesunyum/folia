// fol-4b5: the asset content hash covers only what the bake reads, so
// shader or sky-color tweaks don't re-run Blender for every asset.
import { describe, expect, it } from 'vitest'
import { palette } from '../../src/palette'
import { assetSources, bakePalette, hashAsset } from './build'

describe('assetSources', () => {
  it('excludes the shader features: they never reach the bake', () => {
    expect(
      assetSources('cortico/fragment').some((f) => f.endsWith('src/materials/features.ts')),
    ).toBe(false)
  })

  it('still lists palette.ts so the dev watcher wakes on palette saves', () => {
    expect(assetSources('cortico/fragment').some((f) => f.endsWith('src/palette.ts'))).toBe(true)
  })

  it('lists the slot limit: shrinking it must re-validate packed _IDs', () => {
    expect(assetSources('cortico/fragment').some((f) => f.endsWith('src/groupSlots.ts'))).toBe(true)
  })
})

describe('bakePalette', () => {
  it('carries only the entries the Blender bake reads', () => {
    expect(bakePalette()).toEqual({ mint: palette.mint })
  })
})

describe('hashAsset', () => {
  it('is deterministic and a 16-hex digest', () => {
    const hash = hashAsset('cortico/fragment')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hashAsset('cortico/fragment')).toBe(hash)
  })
})
