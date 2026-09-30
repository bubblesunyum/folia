import { BatchedMesh } from 'three'
import type { BatchCapacity } from '../assets/townBatches'
import { materials } from '../materials/shared'

/** One empty town mesh: its shared material, depth material and shadow flags. */
export function createTownMesh(batch: string, capacity: BatchCapacity): BatchedMesh {
  const shared = materials[batch]
  if (!shared) throw new Error(`no shared material for batch "${batch}"`)
  const mesh = new BatchedMesh(
    capacity.maxInstances,
    capacity.maxVertices,
    capacity.maxIndices,
    shared.material,
  )
  mesh.name = batch
  mesh.customDepthMaterial = shared.depth
  mesh.castShadow = shared.castShadow
  mesh.receiveShadow = true
  return mesh
}
