// Raycast → slot picking shared by the hover and pedestal rigs (fol-8z6).
// The hit vertex's `groupId` is already the global group-state slot (pack
// remapped it). Returns null on a miss; throws on a missing group channel:
// fail closed, never hover or open the whole town on a missing attribute.
// three imports are type-only (erased at build), so this stays out of the
// prerender graph's runtime (D-047).

import type { BatchedMesh, Camera, Raycaster, Vector2 } from 'three'
import { slotFromGroupId } from './hover'

/**
 * Raycast the already-set `pointer` over `meshes` and read the slot off the
 * hit vertex — today's contract in both rigs, kept verbatim. Callers set the
 * pointer from the event (NDC) before the frame consumes it.
 */
export function pickSlotFromHit(
  meshes: ReadonlyMap<string, BatchedMesh>,
  raycaster: Raycaster,
  pointer: Vector2,
  camera: Camera,
): number | null {
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([...meshes.values()], false)
  const hit = hits[0]
  if (!hit?.face) return null
  const attr = (hit.object as BatchedMesh).geometry.getAttribute('groupId')
  if (!attr) throw new Error('picking: batch has no groupId attribute')
  return slotFromGroupId((vertex) => attr.getX(vertex), hit.face.a)
}
