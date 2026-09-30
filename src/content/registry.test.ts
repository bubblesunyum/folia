import { describe, expect, it } from 'vitest'
import { CasePanel } from './Panel'
import { rendererFor } from './registry'

describe('rendererFor', () => {
  it('resolves the panel kind', () => {
    expect(rendererFor('panel')).toBe(CasePanel)
  })

  it('fails closed on unknown kinds', () => {
    expect(() => rendererFor('gallery')).toThrow()
    expect(() => rendererFor('')).toThrow()
  })
})
