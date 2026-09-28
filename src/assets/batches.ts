// From a packed GLB to one BatchedMesh per shared material (D-032, D-033).
// Every primitive is dequantized to Float32 and baked into world space first,
// so the batch never inherits a storage type from whichever geometry came
// first, and custom attributes are renamed to what the material features read.

import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  type Material,
  type Mesh,
  type MeshDepthMaterial,
  type Object3D,
} from 'three'
import { customStorage, parseMeshName } from './batchSchema'

/** glTF semantic, as GLTFLoader lowercases it → the shader attribute name. */
const RENAMED: Readonly<Record<string, string>> = {
  _id: 'groupId',
  _ao: 'bakedAo',
  _night: 'bakedNight',
}

/** A Float32, world-space copy of `mesh`'s geometry, custom attributes renamed and rescaled. */
export function dequantize(mesh: Mesh): BufferGeometry {
  const source = mesh.geometry
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const { count, itemSize } = attribute
    const range = customStorage[name.toUpperCase()]?.range ?? 1
    const array = new Float32Array(count * itemSize)
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < itemSize; c++) {
        array[i * itemSize + c] = attribute.getComponent(i, c) * range
      }
    }
    out.setAttribute(RENAMED[name] ?? name, new BufferAttribute(array, itemSize))
  }
  if (source.index) out.setIndex(new BufferAttribute(Uint32Array.from(source.index.array), 1))
  out.applyMatrix4(mesh.matrixWorld)
  return out
}

export interface BatchMaterial {
  material: Material
  depth: MeshDepthMaterial
  castShadow: boolean
}

/** Every mesh under `root`, grouped by the material segment of its `<hood>.<object>.<material>.<lod>` name. */
export function geometriesByBatch(root: Object3D): Map<string, BufferGeometry[]> {
  root.updateMatrixWorld(true)
  const batches = new Map<string, BufferGeometry[]>()
  root.traverse((object) => {
    if (!(object as Mesh).isMesh) return
    const name = parseMeshName(object.userData.name ?? '')
    if (!name) throw new Error(`mesh "${object.userData.name}" breaks the naming contract`)
    const list = batches.get(name.material) ?? []
    list.push(dequantize(object as Mesh))
    batches.set(name.material, list)
  })
  return batches
}

/** One BatchedMesh per batch, each geometry added once as an identity instance. */
export function buildBatches(
  geometries: Map<string, BufferGeometry[]>,
  materials: Readonly<Record<string, BatchMaterial>>,
): BatchedMesh[] {
  return [...geometries].map(([batch, list]) => {
    const shared = materials[batch]
    if (!shared) throw new Error(`no shared material for batch "${batch}"`)
    const vertices = list.reduce((n, g) => n + (g.attributes.position?.count ?? 0), 0)
    const indices = list.reduce((n, g) => n + (g.index?.count ?? 0), 0)
    const mesh = new BatchedMesh(list.length, vertices, indices, shared.material)
    for (const geometry of list) mesh.addInstance(mesh.addGeometry(geometry))
    mesh.name = batch
    mesh.customDepthMaterial = shared.depth
    mesh.castShadow = shared.castShadow
    mesh.receiveShadow = true
    return mesh
  })
}
