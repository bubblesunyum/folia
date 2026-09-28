import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { BatchedMesh } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildBatches, geometriesByBatch } from '../assets/batches'
import { reportSwap, useAssetUrl } from '../assets/useAssetUrl'
import { materials } from '../materials/shared'

/** A packed Blender asset, drawn as one BatchedMesh per shared material. */
export function BlenderAsset({ asset }: { asset: string }) {
  const url = useAssetUrl(asset)
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const batches = useMemo(() => buildBatches(geometriesByBatch(gltf.scene), materials), [gltf])

  // Disposing on unmount would break StrictMode's remount, so a swap disposes
  // the batches it replaces instead.
  const shown = useRef<BatchedMesh[]>([])
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    for (const old of shown.current) if (!batches.includes(old)) old.dispose()
    shown.current = batches
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        reportSwap(asset)
        // Tests wait on this rather than on a timeout.
        canvas.dataset.assets = 'drawn'
      }),
    )
  }, [asset, batches, canvas])

  return (
    <>
      {batches.map((batch) => (
        <primitive key={batch.uuid} object={batch} />
      ))}
    </>
  )
}
