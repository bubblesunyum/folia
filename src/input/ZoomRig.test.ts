import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('one reduced-motion reader', () => {
  it('ZoomRig holds no local matchMedia query', () => {
    const source = readFileSync(new URL('./ZoomRig.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('window.matchMedia')
    expect(source).not.toContain('.matchMedia(')
    expect(source).not.toContain('prefers-reduced-motion')
    expect(source).toContain('readReducedMotion')
  })
})
