import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WispLight.tsx', import.meta.url), 'utf8')

describe('WispLight wiring (fol-5co)', () => {
  it('derives the hood from the shared hook, defaulting to Cortico', () => {
    expect(source).toContain('useHood()')
    expect(source).not.toContain('useParams()')
  })

  it('glows both the light and the sprite in the route hood signature', () => {
    const wired = source.match(/signatureColor\(hood\)/g) ?? []
    expect(wired).toHaveLength(2)
    expect(source).not.toContain("signatureColor('cortico')")
  })
})
