// The town batch registry's React rig (D-032): owns one TownRegistry for the
// canvas, renders its meshes, and invalidates the demand loop on change.
// Disposal of replaced meshes happens after commit; there is deliberately no
// unmount disposal, which would break StrictMode's remount the same way it
// would for per-asset batches. GPU resources release with the context.

import { assetTriangles } from 'virtual:folia-assets'
import { useThree } from '@react-three/fiber'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { BatchedMesh } from 'three'
import {
  type BatchCapacity,
  capacityFromManifest,
  MINIMUM_BATCH_CAPACITY,
  withDerivedCapacity,
} from '../assets/townBatches'
import { type TownGeometries, TownRegistry } from '../assets/townRegistry'
import { derivedBatches, materials } from '../materials/shared'
import { createTownMesh } from './townMesh'

interface TownBatchesApi {
  registerAsset: (asset: string, geometries: TownGeometries) => void
  unregisterAsset: (asset: string) => void
  /** The town-wide meshes by batch name, for passes that draw them directly. */
  meshes: ReadonlyMap<string, BatchedMesh>
}

const TownBatchesContext = createContext<TownBatchesApi | null>(null)

export function useTownBatches(): TownBatchesApi {
  const api = useContext(TownBatchesContext)
  if (!api) throw new Error('useTownBatches outside TownBatches')
  return api
}

export function TownBatches({ children }: { children: ReactNode }) {
  const invalidate = useThree((state) => state.invalidate)
  // Bumped when a batch grows, so the new mesh object renders.
  const [, setGeneration] = useState(0)
  const [registry] = useState(() => {
    const capacities = withDerivedCapacity(capacityFromManifest(assetTriangles), derivedBatches)
    const caps = new Map<string, BatchCapacity>()
    for (const batch of Object.keys(materials)) {
      caps.set(batch, capacities[batch] ?? { ...MINIMUM_BATCH_CAPACITY })
    }
    return new TownRegistry(caps, createTownMesh, () => setGeneration((n) => n + 1))
  })

  const registerAsset = useCallback(
    (asset: string, geometries: TownGeometries) => {
      registry.register(asset, geometries)
      invalidate()
    },
    [invalidate, registry],
  )
  const unregisterAsset = useCallback(
    (asset: string) => {
      registry.unregister(asset)
      invalidate()
    },
    [invalidate, registry],
  )

  // Retired meshes left the scene at commit; dispose them after.
  useEffect(() => {
    for (const mesh of registry.drainRetired()) mesh.dispose()
  })

  const api = useMemo(
    () => ({ registerAsset, unregisterAsset, meshes: registry.meshes }),
    [registerAsset, unregisterAsset, registry],
  )

  return (
    <TownBatchesContext.Provider value={api}>
      {[...registry.meshes.values()].map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
      {children}
    </TownBatchesContext.Provider>
  )
}
