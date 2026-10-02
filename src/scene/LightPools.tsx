// Light-pool decals along the terrace walk lines (D-038, fol-0sj). No
// lantern or path geometry is modeled yet, so the walk lines below are the
// stand-in: plan-view polylines where lanterns/paths will go, grounded onto
// the real terrace surfaces by a downward raycast at mount. Each grounded
// sample becomes one quad in a single merged additive mesh (one draw call).
//
// The mesh hides entirely by day (visible gate on the night weight) and the
// material's opacity rides the same weight, so daylight is exactly unchanged.

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type BatchedMesh, type BufferGeometry, Raycaster, Vector3 } from 'three'
import {
  buildLightPoolGeometry,
  createLightPoolMaterial,
  POOL_LIFT_M,
  POOL_RADIUS_M,
  POOL_SPACING_M,
  ringWalkLine,
  sampleWalkLine,
  type WalkLine,
} from '../materials/lightPool'
import { useLook } from '../time/lookContext'
import { useTownBatches } from './TownBatches'

// Walk lines in plan view (fol-0sj): the forum ring, a mid-terrace ring, and
// the east path toward the meadow annex. Stand-ins until lanterns/paths are
// modeled — samples that hit no walkable surface are dropped.
const WALK_LINES: WalkLine[] = [
  ringWalkLine([0, 0], 3.5),
  ringWalkLine([0, 0], 7.5),
  [
    [6, 2],
    [15, 4],
  ],
]

/** Only walkable batches ground a pool: never water, neon, or foliage. */
const WALK_TARGETS = ['cream', 'gold', 'ground']

/** Frames to keep polling for drawn assets before grounding on what's there. */
const GROUND_RETRIES = 900

/**
 * Registry content fingerprint (fol-0sj): mesh identity, instance count and
 * attribute versions/sizes, following the pickSlot precedent — any
 * register/unregister/grow/compact moves it. Threaded into the grounding
 * effect's deps so a registry hot-swap re-grounds instead of going stale;
 * stable content keeps one grounding per mount in production.
 */
function contentFingerprint(meshes: ReadonlyMap<string, BatchedMesh>): string {
  const parts: string[] = []
  for (const [name, mesh] of meshes) {
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const group = geometry.getAttribute('groupId')
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

export function LightPools() {
  const { meshes } = useTownBatches()
  const {
    look: { night },
  } = useLook()
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const material = useMemo(() => createLightPoolMaterial(), [])
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const geometryRef = useRef<BufferGeometry | null>(null)
  // Re-grounds when the registry content moves (dev-loop hot-swap); stable
  // in production, where the grounding still runs once per content version.
  const fingerprint = contentFingerprint(meshes)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `fingerprint` is the re-ground trigger
  useEffect(() => {
    let live = true
    let attempts = 0
    let frame = 0
    const raycaster = new Raycaster()
    const down = new Vector3(0, -1, 0)
    const ground = () => {
      if (!live) return
      attempts += 1
      const targets = WALK_TARGETS.flatMap((name) => {
        const mesh = meshes.get(name)
        return mesh ? [mesh] : []
      })
      const drawn = canvas.dataset.drawnAssets ?? ''
      const ready = drawn.includes('cortico/fragment') || attempts >= GROUND_RETRIES
      if (ready && targets.length > 0) {
        const spots = WALK_LINES.flatMap((line) =>
          sampleWalkLine(line, POOL_SPACING_M).flatMap(([x, z]) => {
            raycaster.set(new Vector3(x, 40, z), down)
            raycaster.far = 80
            const hit = raycaster.intersectObjects(targets, false)[0]
            return hit ? [{ x, y: hit.point.y + POOL_LIFT_M, z, r: POOL_RADIUS_M }] : []
          }),
        )
        if (live) {
          const built = buildLightPoolGeometry(spots)
          geometryRef.current = built
          setGeometry(built)
          invalidate()
        }
        return
      }
      frame = requestAnimationFrame(ground)
    }
    frame = requestAnimationFrame(ground)
    return () => {
      live = false
      cancelAnimationFrame(frame)
      geometryRef.current?.dispose()
      geometryRef.current = null
    }
  }, [meshes, canvas, invalidate, fingerprint])

  // No local invalidate on `night`: MaterialLook already invalidates on every
  // look change, which covers the visible gate below.

  useEffect(() => () => material.dispose(), [material])

  if (!geometry) return null
  return <mesh geometry={geometry} material={material} visible={night > 0.001} />
}
