import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { geometriesByBatch, withDerived } from '../assets/batches'
import { hoodOf, shouldStreamHigh } from '../assets/lods'
import { reportSwap, useLodUrl } from '../assets/useAssetUrl'
import { derivedBatches } from '../materials/shared'
import { markAssetDrawn, setCanvasHook, unmarkAssetDrawn } from '../testHooks'
import { useVantageHood } from '../useHood'
import { useTownBatches } from './TownBatches'

const withMeshopt = (loader: GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder)
}

/**
 * One LOD side's town-batch registration: derived geometry under `key`,
 * drawn on the second frame, unregistered whole on unmount. The town read
 * registers under its asset id; the hero stream under `<asset>.high` — both
 * mark the same drawn asset, so the `drawnAssets` hook keeps naming assets,
 * never files. Only the town read reports the swap and the town-drawn flag;
 * the stream's repeats would no-op through the idempotent writers.
 */
function useBatchRegistration(asset: string, key: string, gltf: GLTF): void {
  const { registerAsset, unregisterAsset, hasAsset } = useTownBatches()
  const geometries = useMemo(
    () => withDerived(geometriesByBatch(gltf.scene), derivedBatches),
    [gltf],
  )

  const canvas = useThree((state) => state.gl.domElement)
  const isTownRead = key === asset
  useEffect(() => {
    registerAsset(key, geometries)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (isTownRead) {
          reportSwap(asset)
          // Tests wait on this rather than on a timeout.
          setCanvasHook(canvas, 'assets', 'drawn')
        }
        // ...and on every registered asset, not just the first: with two
        // assets sharing the batches the flag above fires for whichever
        // parses first, while this lists what is actually in the batches.
        setCanvasHook(canvas, 'drawnAssets', markAssetDrawn(asset))
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      unregisterAsset(key)
      // The drawn mark stays while either twin still contributes: check
      // both the town key and the `<asset>.high` key, since the registry
      // lookup is exact-key. (No unload is a navigation policy, not a
      // StrictMode exemption: the remount re-registers.)
      if (!hasAsset(asset) && !hasAsset(`${asset}.high`)) unmarkAssetDrawn(asset)
    }
  }, [asset, key, isTownRead, geometries, registerAsset, unregisterAsset, hasAsset, canvas])
}

/**
 * A packed Blender asset, contributing its geometry to the town-wide
 * batches — mid LOD always, high LOD streamed (fol-l7d.2, D-072).
 *
 * At `/` the town loads mid only. At the hood's vantage (`/<hood>` and
 * below) the high hero stream joins it, preloaded on hover-intent over a
 * link to the hood so the flight starts warm. The stream latches: Milestone
 * 1 never unloads (D-047). Mid and high register under different registry
 * keys but mark the same drawn asset, so the `drawnAssets` hook keeps
 * naming assets, never files.
 */
export function BlenderAsset({ asset }: { asset: string }) {
  const url = useLodUrl(asset, 'mid')
  const gltf = useLoader(GLTFLoader, url, withMeshopt)
  useBatchRegistration(asset, asset, gltf)

  const hood = hoodOf(asset)
  const project = useVantageHood()
  // Latched: once the high stream joins it stays for the session.
  const [streamHigh, setStreamHigh] = useState(() => shouldStreamHigh(project ?? undefined, hood))
  useEffect(() => {
    if (shouldStreamHigh(project ?? undefined, hood)) setStreamHigh(true)
  }, [project, hood])

  const highUrl = useLodUrl(asset, 'high')
  useEffect(() => {
    // Hover-intent preload (D-028): warming the hero stream while the
    // visitor still reads the town, so the flight starts warm. Preload
    // only — mounting (and rendering) waits for the vantage.
    if (!highUrl) return
    const onPointerOver = (event: PointerEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor) return
      let path = ''
      try {
        path = new URL((anchor as HTMLAnchorElement).href, window.location.origin).pathname
      } catch {
        return
      }
      if (path === `/${hood}` || path.startsWith(`/${hood}/`)) {
        useLoader.preload(GLTFLoader, highUrl, withMeshopt)
      }
    }
    document.addEventListener('pointerover', onPointerOver)
    return () => document.removeEventListener('pointerover', onPointerOver)
  }, [hood, highUrl])

  return streamHigh && highUrl ? <HighLod asset={asset} /> : null
}

/**
 * The hood's hero stream: same asset, high file, its own registry key. Never
 * unmounts once mounted (no unload in Milestone 1); the drawn mark stays the
 * asset id, so route specs see the same town they always have.
 */
function HighLod({ asset }: { asset: string }) {
  const url = useLodUrl(asset, 'high')
  // Fail closed on drift: the stream mounts only where a high side exists.
  if (url === null) throw new Error(`lods: "${asset}" has no high side — it cannot stream`)
  const gltf = useLoader(GLTFLoader, url, withMeshopt)
  useBatchRegistration(asset, `${asset}.high`, gltf)

  return null
}
