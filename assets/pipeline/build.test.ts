// fol-4b5: the asset content hash covers only what the bake reads, so
// shader or sky-color tweaks don't re-run Blender for every asset.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { palette } from '../../src/palette'
import { assetSources, bakePalette, hashAsset, listAssets } from './build'

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

  it('hashes the forum files with the fragment, whose bake reads them', () => {
    // hashAsset is a content hash over exactly assetSources, so listing here
    // is what makes a forum edit invalidate the fragment (fol-kes.4).
    const sources = assetSources('cortico/fragment')
    expect(sources.some((f) => f.endsWith('cortico/forum.json'))).toBe(true)
    expect(sources.some((f) => f.endsWith('cortico/forum-layout.json'))).toBe(true)
  })

  it('lets no unrelated asset rebuild on forum edits', () => {
    for (const asset of listAssets()) {
      if (asset === 'cortico/fragment' || asset === 'cortico/forum') continue
      const sources = assetSources(asset)
      expect(sources.some((f) => f.endsWith('cortico/forum.json'))).toBe(false)
      expect(sources.some((f) => f.endsWith('cortico/forum-layout.json'))).toBe(false)
    }
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

describe('bake outputs', () => {
  it('are never hashed as their own asset sources (fol-kes.10)', () => {
    // A bake that rewrites a file its own hash covers leaves assets:check
    // stale until a second build. Written files are the sibling paths a
    // bake script binds with with_name(...) and then write_text()s.
    for (const asset of listAssets()) {
      const script = assetSources(asset).find((f) => f.endsWith(`/${asset}.py`))
      expect(script, `${asset} lists its bake script`).toBeDefined()
      const src = readFileSync(script as string, 'utf8')
      const written = [...src.matchAll(/^(\w+)\s*=.*with_name\(\s*["']([^"']+)["']/gm)]
        .filter(([, v]) => new RegExp(`\\b${v}\\.write_text\\(`).test(src))
        .map((m) => m[2])
      for (const name of written) {
        expect(
          assetSources(asset).map((f) => basename(f)),
          `${asset} hashes ${name}, which its own bake writes`,
        ).not.toContain(name)
      }
    }
  })
})
