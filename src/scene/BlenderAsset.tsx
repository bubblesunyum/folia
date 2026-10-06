import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { geometriesByBatch, withDerived } from '../assets/batches'
import { hoodOf, lodStems, shouldStreamHigh } from '../assets/lods'
import { reportSwap, useLodUrl } from '../assets/useAssetUrl'
import { derivedBatches } from '../materials/shared'
import { markAssetDrawn, setCanvasHook, unmarkAssetDrawn } from '../testHooks'
import { useVantageHood } from '../useHood'
import { useTownBatches } from './TownBatches'

const withMeshopt = (loader: GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder)
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
  const { mid, high } = lodStems(asset)
  const url = useLodUrl(asset, mid)
  const gltf = useLoader(GLTFLoader, url, withMeshopt)
  const { registerAsset, unregisterAsset } = useTownBatches()
  const geometries = useMemo(
    () => withDerived(geometriesByBatch(gltf.scene), derivedBatches),
    [gltf],
  )

  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    registerAsset(asset, geometries)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        reportSwap(asset)
        // Tests wait on this rather than on a timeout.
        setCanvasHook(canvas, 'assets', 'drawn')
        // ...and on every registered asset, not just the first: with two
        // assets sharing the batches the flag above fires for whichever
        // parses first, while this lists what is actually in the batches.
        setCanvasHook(canvas, 'drawnAssets', markAssetDrawn(asset))
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      unmarkAssetDrawn(asset)
      unregisterAsset(asset)
    }
  }, [asset, geometries, registerAsset, unregisterAsset, canvas])

  const hood = hoodOf(asset)
  const project = useVantageHood()
  // Latched: once the high stream joins it stays for the session.
  const [streamHigh, setStreamHigh] = useState(() => shouldStreamHigh(project ?? undefined, hood))
  useEffect(() => {
    if (shouldStreamHigh(project ?? undefined, hood)) setStreamHigh(true)
  }, [project, hood])

  const highUrl = useLodUrl(asset, high ?? mid)
  useEffect(() => {
    // Hover-intent preload (D-028): warming the hero stream while the
    // visitor still reads the town, so the flight starts warm. Preload
    // only — mounting (and rendering) waits for the vantage.
    if (!high) return
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
  }, [hood, high, highUrl])

  return streamHigh && high ? <HighLod asset={asset} file={high} /> : null
}

/**
 * The hood's hero stream: same asset, high file, its own registry key. Never
 * unmounts once mounted (no unload in Milestone 1); the drawn mark stays the
 * asset id, so route specs see the same town they always have.
 */
function HighLod({ asset, file }: { asset: string; file: string }) {
  const key = `${asset}.high`
  const url = useLodUrl(asset, file)
  const gltf = useLoader(GLTFLoader, url, withMeshopt)
  const { registerAsset, unregisterAsset, hasAsset } = useTownBatches()
  const geometries = useMemo(
    () => withDerived(geometriesByBatch(gltf.scene), derivedBatches),
    [gltf],
  )

  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    registerAsset(key, geometries)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        // The asset id, not the registry key: mid already named it, and the
        // hook names assets so specs never learn file names.
        setCanvasHook(canvas, 'drawnAssets', markAssetDrawn(asset))
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      // No unload is a navigation policy, not a StrictMode exemption: the
      // remount re-registers. The drawn mark stays while mid is registered.
      unregisterAsset(key)
      if (!hasAsset(asset)) unmarkAssetDrawn(asset)
    }
  }, [asset, key, geometries, registerAsset, unregisterAsset, hasAsset, canvas])

  return null
}
