import hashes from 'virtual:folia-assets'
import { startTransition, useEffect, useState } from 'react'
import type { AssetEvent } from '../../assets/pipeline/vitePlugin'

/** The newest hash per asset, so a remount after a hot swap keeps the new geometry. */
const latest: Record<string, string> = { ...hashes }

/** Asset → when its unreported save was seen, for `reportSwap`. */
const pendingSaves = new Map<string, number>()

/** The content hash currently pinned for `asset`, following hot swaps. */
function useAssetHash(asset: string): string {
  const [hash, setHash] = useState(latest[asset])
  if (!hash) throw new Error(`no asset "${asset}" in assets/manifest.json`)

  useEffect(() => {
    const hot = import.meta.hot
    if (!hot) return
    const onAsset = (event: AssetEvent) => {
      if (event.asset !== asset) return
      latest[asset] = event.hash
      pendingSaves.set(asset, event.savedAt)
      startTransition(() => setHash(event.hash))
    }
    hot.on('folia:asset', onAsset)
    return () => hot.off('folia:asset', onAsset)
  }, [asset])

  return hash
}

/**
 * The URL of an asset's packed GLB, versioned by its content hash. In dev it
 * follows the pipeline's rebuilds, inside a transition, so the old geometry
 * stays on screen while the new one loads.
 */
export function useAssetUrl(asset: string): string {
  return `/assets/${asset}.glb?v=${useAssetHash(asset)}`
}

/**
 * The URL of one side of an asset's D-072 split (fol-l7d.2): `file` is the
 * manifest-recorded stem (`cortico/fragment.mid`), versioned by the same
 * per-asset content hash as the full export — mid and high twins come from
 * one build, so one hash versions both.
 */
export function useLodUrl(asset: string, file: string): string {
  return `/assets/${file}.glb?v=${useAssetHash(asset)}`
}

/** Called once a swapped asset has drawn; logs save-to-pixels time (D-034 target: under 10 s). */
export function reportSwap(asset: string): void {
  const savedAt = pendingSaves.get(asset)
  if (savedAt === undefined) return
  pendingSaves.delete(asset)
  const ms = Date.now() - savedAt
  console.info(`folia: ${asset} save → pixels ${(ms / 1000).toFixed(2)} s`)
}
