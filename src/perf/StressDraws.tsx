import { useMemo } from 'react'
import { BatchedMesh, BoxGeometry, BufferAttribute, Matrix4 } from 'three'
import { materials } from '../materials/shared'

const SIZE = 0.05
const SPREAD = 8
const SEED = 1

/**
 * `count` tiny boxes in one batch on the cream program, casting shadows like
 * any town piece. They cover almost no pixels, so what they add to a frame is
 * the price of a sub-draw itself, in both passes (spike 3).
 */
export function StressDraws({ count }: { count: number }) {
  const batch = useMemo(() => {
    const cream = materials.cream
    if (!cream) throw new Error('no cream material')
    const box = new BoxGeometry(SIZE, SIZE, SIZE)
    // The cream program reads these; a real piece always carries them.
    const vertices = box.attributes.position?.count ?? 0
    box.setAttribute('groupId', new BufferAttribute(new Float32Array(vertices), 1))
    box.setAttribute('bakedAo', new BufferAttribute(new Float32Array(vertices).fill(1), 1))
    box.setAttribute('bakedNight', new BufferAttribute(new Float32Array(vertices * 3), 3))
    const mesh = new BatchedMesh(count, vertices, box.index?.count ?? 0, cream.material)
    const geometry = mesh.addGeometry(box)
    const random = mulberry32(SEED)
    const matrix = new Matrix4()
    for (let i = 0; i < count; i++) {
      matrix.makeTranslation(
        (random() - 0.5) * SPREAD,
        random() * SPREAD * 0.5,
        (random() - 0.5) * SPREAD,
      )
      mesh.setMatrixAt(mesh.addInstance(geometry), matrix)
    }
    mesh.customDepthMaterial = cream.depth
    mesh.castShadow = true
    mesh.receiveShadow = true
    box.dispose()
    return mesh
  }, [count])

  // Not disposed on unmount: StrictMode's remount would keep the disposed batch
  // (see BlenderAsset). `count` is fixed per page load, so nothing leaks.
  return <primitive object={batch} />
}

// Seeded, so every run prices the same layout.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
