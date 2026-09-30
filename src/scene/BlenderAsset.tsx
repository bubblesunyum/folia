import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { geometriesByBatch, withDerived } from '../assets/batches'
import { reportSwap, useAssetUrl } from '../assets/useAssetUrl'
import { derivedBatches } from '../materials/shared'
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
        canvas.dataset.assets = 'drawn'
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      unregisterAsset(asset)
    }
  }, [asset, geometries, registerAsset, unregisterAsset, canvas])

  return null
}
