// `useLodUrl` names a side, never a file (fol-v3z): the manifest-recorded
// stems resolve inside, so a re-split never touches the scene. Pinned
// without pixels: mid always resolves, high resolves where a hero stream
// exists and is null where the vantage mounts nothing.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import manifest from '../../assets/manifest.json'
import { useLodUrl } from './useAssetUrl'

function Url({ asset, side }: { asset: string; side: 'mid' | 'high' }) {
  const mid = useLodUrl(asset, 'mid')
  const high = useLodUrl(asset, 'high')
  return <span>{(side === 'mid' ? mid : high) ?? 'none'}</span>
}

function hashOf(asset: string): string {
  const record = (manifest as Record<string, { hash: string }>)[asset]
  if (!record) throw new Error(`test manifest is missing ${asset}`)
  return record.hash
}

describe('useLodUrl', () => {
  it('resolves the mid stem for a split asset', () => {
    expect(renderToStaticMarkup(<Url asset="cortico/fragment" side="mid" />)).toBe(
      `<span>/assets/cortico/fragment.mid.glb?v=${hashOf('cortico/fragment')}</span>`,
    )
  })

  it('resolves the high stem where a hero stream exists', () => {
    expect(renderToStaticMarkup(<Url asset="cortico/fragment" side="high" />)).toBe(
      `<span>/assets/cortico/fragment.high.glb?v=${hashOf('cortico/fragment')}</span>`,
    )
  })

  it('resolves a bare mid file, and no high stream, for a single-LOD asset', () => {
    expect(renderToStaticMarkup(<Url asset="cortico/meadow" side="mid" />)).toBe(
      `<span>/assets/cortico/meadow.glb?v=${hashOf('cortico/meadow')}</span>`,
    )
    expect(renderToStaticMarkup(<Url asset="cortico/meadow" side="high" />)).toBe(
      '<span>none</span>',
    )
  })
})
