import { describe, expect, it } from 'vitest'
import {
  assertTopLevelSlug,
  assertUniqueSlugs,
  caseFrontmatterSchema,
  projectFrontmatterSchema,
} from './schema'

describe('case frontmatter', () => {
  it('accepts a panel case', () => {
    expect(
      caseFrontmatterSchema.parse({
        title: 'platform',
        kind: 'panel',
        summary: 'the platform',
        object: 'laptop',
      }),
    ).toMatchObject({ kind: 'panel' })
  })

  it('rejects unknown kinds and unknown keys', () => {
    expect(() =>
      caseFrontmatterSchema.parse({
        title: 'x',
        kind: 'gallery',
        summary: 'y',
        object: 'laptop',
      }),
    ).toThrow()
    expect(() =>
      caseFrontmatterSchema.parse({
        title: 'x',
        kind: 'panel',
        summary: 'y',
        object: 'laptop',
        typo: 'z',
      }),
    ).toThrow()
  })
})

describe('project frontmatter', () => {
  it('accepts a palette neon', () => {
    expect(
      projectFrontmatterSchema.parse({ title: 'cortico', summary: 'forum', neon: 'mint' }),
    ).toMatchObject({ neon: 'mint' })
  })

  it('rejects a neon outside the palette', () => {
    expect(() =>
      projectFrontmatterSchema.parse({ title: 'cortico', summary: 'forum', neon: '#4BFED2' }),
    ).toThrow()
  })
})

describe('slugs', () => {
  it('rejects reserved top-level words', () => {
    for (const slug of ['resume', 'contact', 'simple']) {
      expect(() => assertTopLevelSlug(slug, 'content/x/index.mdx')).toThrow()
    }
    expect(() => assertTopLevelSlug('cortico', 'content/cortico/index.mdx')).not.toThrow()
  })

  it('rejects malformed slugs', () => {
    for (const slug of ['Platform', 'has space', 'under_score', '-lead', 'trail-', '']) {
      expect(() => assertTopLevelSlug(slug, 'content/x/index.mdx')).toThrow()
    }
  })

  it('rejects duplicate slugs within a parent', () => {
    expect(() =>
      assertUniqueSlugs(['platform', 'recorder', 'platform'], 'content/cortico'),
    ).toThrow()
    expect(() =>
      assertUniqueSlugs(['platform', 'recorder', 'medley'], 'content/cortico'),
    ).not.toThrow()
  })
})
