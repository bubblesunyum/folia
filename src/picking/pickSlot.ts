// Raycast → slot picking shared by the hover and pedestal rigs (fol-8z6,
// fol-hft). Picks against per-group invisible hit volumes (D-021) instead of
// sweeping `raycaster.intersectObjects` over every town BatchedMesh: one
// ray-vs-box test per slot, then triangle tests only inside the volumes the
// ray enters. A pick scales with the hit group's triangles, not the town's —
// the ~177k-tri sweep on each pointer move is gone. The additive neon glow
// shell is excluded: it redraws `neon`'s geometry, so it can only double
// cost, never resolve a new slot.
//
// The volumes cache rebuilds only when a batch's content fingerprint moves
// (mesh identity, instance count, attribute versions or sizes), so steady
// hovers pay the query alone. three imports are type-only (erased at build),
// so this stays out of the prerender graph's runtime (D-047).

import type { BatchedMesh, Camera, Raycaster, Vector2 } from 'three'
import {
  buildHitVolumes,
  type HitVolume,
  type HitVolumeSource,
  isPickableBatch,
  pickHitVolume,
} from './hitVolumes'
import { recordPick, recordRebuild } from './pickStats'

interface VolumeCache {
  key: string
  volumes: ReadonlyMap<number, HitVolume>
}

let cache: VolumeCache | null = null

/** Drops the cached volumes: tests reset here. */
export function clearPickCache(): void {
  cache = null
}

/** Content fingerprint: any register/unregister/grow/compact moves it. */
function fingerprint(meshes: ReadonlyMap<string, BatchedMesh>): string {
  const parts: string[] = []
  for (const [name, mesh] of meshes) {
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const group = geometry.getAttribute('groupId')
    // Interleaved attributes carry no version: fall back to -1, which still
    // fingerprints (every content write bumps the mesh another way).
    const versionOf = (attr: unknown): number => {
      if (typeof attr === 'object' && attr !== null && 'version' in attr) {
        const version: unknown = (attr as { version: unknown }).version
        if (typeof version === 'number') return version
      }
      return -1
    }
    parts.push(
      [
        name,
        mesh.instanceCount,
        position?.count ?? -1,
        versionOf(position),
        index?.count ?? -1,
        versionOf(index),
        versionOf(group),
      ].join(':'),
    )
  }
  return parts.join('|')
}

/** One batch mesh as a volume source. Throws on a missing group channel: fail closed. */
function sourceFor(name: string, mesh: BatchedMesh): HitVolumeSource | null {
  if (!isPickableBatch(name)) return null
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const group = geometry.getAttribute('groupId')
  if (!position) throw new Error(`picking: batch "${name}" has no position attribute`)
  if (!group) throw new Error('picking: batch has no groupId attribute')
  const getX = (vertex: number): number => group.getX(vertex)
  const index = geometry.getIndex()
  return {
    batch: name,
    vertexCount: position.count,
    indexCount: index?.count ?? position.count,
    positionAt: (vertex: number): readonly [number, number, number] => [
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
    ],
    groupAt: getX,
    indexAt: index ? (at: number): number => index.getX(at) : null,
  }
}

function volumesFor(meshes: ReadonlyMap<string, BatchedMesh>): ReadonlyMap<number, HitVolume> {
  const key = fingerprint(meshes)
  if (!cache || cache.key !== key) {
    const started = performance.now()
    const sources: HitVolumeSource[] = []
    for (const [name, mesh] of meshes) {
      const source = sourceFor(name, mesh)
      if (source) sources.push(source)
    }
    const volumes = buildHitVolumes(sources)
    let triangles = 0
    for (const volume of volumes.values()) triangles += volume.triangles
    cache = { key, volumes }
    recordRebuild(performance.now() - started, volumes.size, triangles)
  }
  return cache.volumes
}

/**
 * Pick the slot under `pointer` against the per-group hit volumes — today's
 * contract in both rigs, kept verbatim. Callers set the pointer from the
 * event (NDC) before the frame consumes it. Returns null on a miss; throws
 * on a missing group channel: fail closed, never hover or open the whole
 * town on a missing attribute.
 */
export function pickSlotFromHit(
  meshes: ReadonlyMap<string, BatchedMesh>,
  raycaster: Raycaster,
  pointer: Vector2,
  camera: Camera,
): number | null {
  raycaster.setFromCamera(pointer, camera)
  const volumes = volumesFor(meshes)
  const { origin, direction } = raycaster.ray
  const started = performance.now()
  const slot = pickHitVolume(
    volumes,
    [origin.x, origin.y, origin.z],
    [direction.x, direction.y, direction.z],
  )
  recordPick(performance.now() - started)
  return slot
}
