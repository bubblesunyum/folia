import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hoodFromProject, signatureColor } from '../palette'

const source = readFileSync(new URL('./MaterialLook.tsx', import.meta.url), 'utf8')

describe('hoodFromProject', () => {
  it('reads Cortico on the town root, which has no :project', () => {
    expect(hoodFromProject(undefined)).toBe('cortico')
  })

  it('passes route projects through as hoods', () => {
    expect(hoodFromProject('cortico')).toBe('cortico')
    expect(hoodFromProject('glyphite')).toBe('glyphite')
  })

  it('fails closed: unmapped hoods reach the throwing signature, never a fallback', () => {
    expect(hoodFromProject('nowhere')).toBe('nowhere')
    expect(() => signatureColor(hoodFromProject('nowhere'))).toThrow()
  })
})

describe('MaterialLook wiring (fol-5co)', () => {
  it('threads the shared hood hook into applyLook', () => {
    expect(source).toContain('useHood()')
    expect(source).toContain('applyLook(look, renderConfig.bloom, palette, hood)')
  })

  it('re-applies the look when the hood changes on nav', () => {
    expect(source).toMatch(/\[look, palette, hood, canvas, invalidate\]/)
  })
})
