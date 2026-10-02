import { describe, expect, it } from 'vitest'
import config from '../../react-router.config'
import { listPrerenderPaths, loadProject } from './load'

// The prerender list is derived from the content directory (react-router
// config function form); a case missing from it builds green and works
// in-app, but direct loads and crawlers 404 on the static host. These pin
// the derived list equal to the loader's, so the two can't drift (fol-ya7).
async function prerenderedPaths(): Promise<string[]> {
  const prerender = config.prerender
  if (typeof prerender === 'function') {
    // The config narrows to a zero-arg fn; the router type takes getStaticPaths.
    const dynamic = prerender as (args: { getStaticPaths: () => string[] }) => unknown
    const result = dynamic({ getStaticPaths: () => [] })
    const paths = result instanceof Promise ? await result : result
    return [...(paths as string[])].sort()
  }
  return [...(prerender ?? [])].sort()
}

describe('prerender coverage', () => {
  it('equals the loader-derived path list exactly', async () => {
    expect(await prerenderedPaths()).toEqual([...listPrerenderPaths()].sort())
  })

  it('prerenders every case slug', async () => {
    const paths = new Set(await prerenderedPaths())
    expect(paths.has('/')).toBe(true)
    expect(paths.has('/cortico')).toBe(true)
    for (const c of loadProject('cortico').cases) {
      expect(paths.has(`/cortico/${c.slug}`)).toBe(true)
    }
  })
})
