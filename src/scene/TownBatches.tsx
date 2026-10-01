// The town batch registry's React rig (D-032): owns one TownRegistry for the
// canvas, renders its meshes, and invalidates the demand loop on change.
// Disposal of replaced meshes happens after commit; there is deliberately no
// unmount disposal, which would break StrictMode's remount the same way it
// would for per-asset batches. GPU resources release with the context.

import { assetIndices, assetTriangles, assetVertices } from 'virtual:folia-assets'
import { addAfterEffect, useThree } from '@react-three/fiber'
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
  manifestCounts,
  withDerivedCapacity,
} from '../assets/townBatches'
import { type TownGeometries, TownRegistry } from '../assets/townRegistry'
import { debug } from '../debug'
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
    const capacities = withDerivedCapacity(
      capacityFromManifest(manifestCounts(assetTriangles, assetVertices, assetIndices)),
      derivedBatches,
    )
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
      {debug.hud && <RendererMemory />}
    </TownBatchesContext.Provider>
  )
}

/**
 * Renderer memory in the HUD (fol-3w2): `renderer.info.memory` (live
 * geometries and textures) beside PerfHud's counters. Its own body-level div
 * because PerfHud owns the readout element; it parks under the readout and
 * only rewrites when the numbers move, so idle frames stay quiet.
 */
function RendererMemory() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'perf-mem'
    el.style.cssText =
      'position:fixed;left:0;padding:4px 8px;top:48px;' +
      'font:11px/1.4 ui-monospace,monospace;color:var(--mint);' +
      'background:var(--forest);pointer-events:none;white-space:pre;'
    document.body.append(el)
    const place = () => {
      const readout = document.querySelector('.perf-readout')
      const top = readout ? 48 + readout.getBoundingClientRect().height + 4 : 48
      el.style.top = `${top}px`
    }
    let last = ''
    const stop = addAfterEffect(() => {
      const { geometries, textures } = gl.info.memory
      const text = `geo ${geometries} · tex ${textures}`
      if (text !== last) {
        last = text
        el.textContent = text
        place()
      }
    })
    return () => {
      stop()
      el.remove()
    }
  }, [gl])

  return null
}
