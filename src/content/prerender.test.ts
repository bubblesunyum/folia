import { describe, expect, it } from 'vitest'
import config from '../../react-router.config'
import { loadProject } from './load'

// The prerender list is hand-maintained; a case missing from it builds green
// and works in-app, but direct loads and crawlers 404 on the static host.
describe('prerender coverage', () => {
  it('prerenders every case slug', () => {
    const paths = new Set(config.prerender ?? [])
    expect(paths.has('/')).toBe(true)
    expect(paths.has('/cortico')).toBe(true)
    for (const c of loadProject().cases) {
      expect(paths.has(`/cortico/${c.slug}`)).toBe(true)
    }
  })
})
