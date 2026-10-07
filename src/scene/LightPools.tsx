// Light-pool decals on authored terrace spots (D-038, fol-kes.4). The spots
// are baked in assets/blender/cortico/fragment.py on the live terrace
// outlines and read from the sibling fragment.pools.only.json — the
// pools-only sibling of fragment.pools.json (the forum-layout
// anchor precedent) — no raycast, no dataset read, no readiness polling.
// The full pools file keeps the outlines and bake provenance for the
// placement spec; the canvas chunk only ever bundles the spots.
// Each spot is one quad in a single merged additive mesh (one draw call),
// gated by the registry holding the owning terraces (reads live per frame,
// like the water pass) and by night.
//
// The mesh hides entirely by day (visible gate on the night weight) and the
// material's opacity rides the same weight, so daylight is exactly unchanged.
// fol-kes.15: the quads carry the terrace group slot (the lift moves them
// with the terraces on hover) and the mesh sits at the owner placement, so
// an off-origin fragment carries its pools with it.

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import fragmentPools from '../../assets/blender/cortico/fragment.pools.only.json' with {
  type: 'json',
}
import {
  buildLightPoolGeometry,
  createLightPoolMaterial,
  lightPoolsReady,
  POOL_OWNER_OFFSET,
  parseLightPoolLayout,
  poolOwnerSlot,
} from '../materials/lightPool'
import { useLook } from '../time/lookContext'
import { useTownBatches } from './TownBatches'

/** Stable mesh position: the owner placement, never reallocated per render. */
const POOL_MESH_POSITION: [number, number, number] = [...POOL_OWNER_OFFSET]

export function LightPools() {
  const { hasAsset } = useTownBatches()
  const {
    look: { night },
  } = useLook()
  const material = useMemo(() => createLightPoolMaterial(), [])
  const spots = useMemo(() => parseLightPoolLayout(fragmentPools), [])
  const geometry = useMemo(() => buildLightPoolGeometry(spots, poolOwnerSlot()), [spots])
  const ref = useRef<Mesh>(null)

  // Owns the merged geometry and the material: both dispose on unmount (the
  // town batches own everything else, and deliberately never dispose here).
  useEffect(() => {
    const owned = { geometry, material }
    return () => {
      owned.geometry.dispose()
      owned.material.dispose()
    }
  }, [geometry, material])

  // No local invalidate on `night`: MaterialLook already invalidates on every
  // look change, and the asset mount invalidates on register — the frames
  // those cause re-evaluate this gate, so idle frames stay quiet.

  useFrame(() => {
    const mesh = ref.current
    if (mesh) mesh.visible = night > 0.001 && lightPoolsReady(hasAsset)
  })

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      visible={false}
      position={POOL_MESH_POSITION}
    />
  )
}
