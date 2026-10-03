import { MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { composeMaterial, inject } from './composer'

const source =
  'uniform float a;\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n}'

describe('inject', () => {
  it('places code around, or instead of, a chunk and the header before main', () => {
    const out = inject(
      source,
      {
        header: 'uniform float b;',
        chunks: {
          begin_vertex: { before: 'pre();', after: 'post();' },
          project_vertex: { instead: 'mine();' },
        },
      },
      'test',
    )
    expect(out).toBe(
      'uniform float a;\nuniform float b;\nvoid main() {\npre();\n#include <begin_vertex>\npost();\nmine();\n}',
    )
  })

  it('nests a later feature closer to the chunk', () => {
    const once = inject(source, { chunks: { begin_vertex: { after: 'one();' } } }, 'test')
    const twice = inject(once, { chunks: { begin_vertex: { after: 'two();' } } }, 'test')
    expect(twice).toContain('#include <begin_vertex>\ntwo();\none();')
  })

  it('throws when the chunk is missing rather than dropping the feature', () => {
    expect(() => inject(source, { chunks: { aomap_fragment: { after: 'x();' } } }, 'test')).toThrow(
      'test has no #include <aomap_fragment>',
    )
  })
})

describe('composeMaterial', () => {
  it('keys the program on the features, not on the shared onBeforeCompile source', () => {
    const a = composeMaterial(new MeshStandardMaterial(), [{ key: 'baked' }, { key: 'group' }])
    const b = composeMaterial(new MeshStandardMaterial(), [{ key: 'baked' }])
    expect(a.customProgramCacheKey()).toBe('baked+group')
    expect(b.customProgramCacheKey()).not.toBe(a.customProgramCacheKey())
  })

  it('throws when a required feature is missing instead of emitting bad GLSL', () => {
    expect(() =>
      composeMaterial(new MeshStandardMaterial(), [
        { key: 'world-position' },
        { key: 'consumer', requires: ['world-position'] },
      ]),
    ).not.toThrow()
    expect(() =>
      composeMaterial(new MeshStandardMaterial(), [
        { key: 'consumer', requires: ['world-position'] },
      ]),
    ).toThrow('consumer requires world-position in the same program')
  })
})
