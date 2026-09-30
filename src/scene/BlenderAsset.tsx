import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { geometriesByBatch, withDerived } from '../assets/batches'
import { reportSwap, useAssetUrl } from '../assets/useAssetUrl'
import { derivedBatches } from '../materials/shared'
import { markAssetDrawn, setCanvasHook, unmarkAssetDrawn } from '../testHooks'
import { useTownBatches } from './TownBatches'

/** A packed Blender asset, contributing its geometry to the town-wide batches. */
export function BlenderAsset({ asset }: { asset: string }) {
  const url = useAssetUrl(asset)
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
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

  return null
}
