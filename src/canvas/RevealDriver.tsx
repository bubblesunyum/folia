// The reveal driver (D-018, D-043, D-044): raises the shared revealHeight
// uniform behind the cream ocean, then parks it. Sky plus the opaque ocean
// paint on the first frame while the town streams; once town content settles
// (or the wait cap hits — the reveal never waits on itself), the warm-up
// compiles every program plus one forced shadow render into a
// composer-matching target, and the town rises through the cream with the
// glossy band. Values, not programs: one uniform write per tick, never a
// recompile, and `shadowMap.enabled` is never touched.
//
// Timing (see revealModel.ts): capped at ~2.5 s, shortened on repeat visits
// (sessionStorage) and deep links (non-root entry), cut to the final state
// under reduced motion. The canvas `data-reveal` flag walks
// ocean → rising → done (plus `data-programs` at done), so specs wait on
// flags, never timeouts.

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type BatchedMesh, type Mesh, PlaneGeometry } from 'three'
import { versionForMeshes } from '../assets/townVersion'
import { warmupScene } from '../materials/composer'
import { reveal } from '../materials/features'
import {
  REVEAL_PARKED_M,
  REVEAL_SEEN_KEY,
  REVEAL_SETTLE_M,
  REVEAL_SETTLE_WAIT_MS,
  REVEAL_START_M,
  REVEAL_WAIT_CAP_MS,
  revealDurationMs,
  revealHeightAt,
  revealProgressAt,
  revealStartFor,
} from '../materials/revealModel'
import { useTownBatches } from '../scene/TownBatches'
import { createCreamOceanMaterial, OCEAN_SIZE_M, oceanUniforms } from './CreamOcean'

/** The canvas `data-reveal` lifecycle a spec can wait on. */
export type RevealPhase = 'ocean' | 'rising' | 'done'

function readRepeatVisit(): boolean {
  try {
    return window.sessionStorage.getItem(REVEAL_SEEN_KEY) !== null
  } catch {
    // Private mode: every visit reads the full sweep.
    return false
  }
}

function markRevealSeen(): void {
  try {
    window.sessionStorage.setItem(REVEAL_SEEN_KEY, '1')
  } catch {
    // Private mode: nothing to remember.
  }
}

/**
 * The town's live top in metres, from the registry's batch bounds — the
 * sweep starts just above it instead of a fixed ceiling, so breadth content
 * taller than today's town still starts covered. Pure traversal; falls back
 * to undefined (the safe ceiling) when a batch is unmeasurable.
 */
function measureContentTop(meshes: ReadonlyMap<string, BatchedMesh>): number | undefined {
  let top: number | undefined
  for (const mesh of meshes.values()) {
    try {
      mesh.computeBoundingBox()
      const y = mesh.boundingBox?.max.y
      if (typeof y === 'number' && Number.isFinite(y)) top = Math.max(top ?? y, y)
    } catch {
      // Unmeasurable batch: the ceiling covers it.
    }
  }
  return top
}

/**
 * The ocean mesh plus the sweep. Mounted inside `<TownBatches>` (so it reads
 * the live registry) but outside every Suspense boundary (so it paints
 * before the town streams).
 */
export function RevealDriver() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const { meshes } = useTownBatches()
  // The registry map is stable, but the effect below must always poll the
  // live one without resubscribing.
  const meshesRef = useRef(meshes)
  meshesRef.current = meshes
  const material = useMemo(() => createCreamOceanMaterial(), [])
  const geometry = useMemo(() => new PlaneGeometry(OCEAN_SIZE_M, OCEAN_SIZE_M, 48, 48), [])
  const meshRef = useRef<Mesh>(null)

  useEffect(() => {
    const owned = { geometry, material }
    return () => {
      owned.geometry.dispose()
      owned.material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const canvas = gl.domElement
    let cancelled = false
    let raf = 0
    let settledTimer = 0
    const startedAt = performance.now()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = revealDurationMs({
      repeat: readRepeatVisit(),
      deepLink: window.location.pathname !== '/',
      reducedMotion,
    })
    // Above the town: every shared program reads full cream until the sweep,
    // and the ocean plane covers the town by depth.
    reveal.uniforms.uRevealHeight.value = REVEAL_START_M
    const mesh = meshRef.current
    if (mesh) {
      mesh.visible = true
      mesh.position.y = REVEAL_START_M
    }
    oceanUniforms.uOceanTime.value = 0
    canvas.dataset.reveal = 'ocean'
    invalidate()

    let lastVersion: number | undefined
    let lastChange = startedAt
    let phase: RevealPhase = 'ocean'
    let riseStart = 0
    let sweepStart = REVEAL_START_M
    // The batch map is pre-populated (one entry per shared material) before
    // any asset registers, so map size says nothing about content. The sweep
    // waits for a registry version past zero — a real asset landing, before
    // or after this effect ran (child effects register first, so a
    // synchronous fast load is already past zero at mount) — and falls back
    // to the wait cap when nothing ever arrives.

    const finish = () => {
      // Parked below the town the band mix is exactly zero: still renders sit
      // on the authored look, and the ocean hides on the same tick.
      reveal.uniforms.uRevealHeight.value = REVEAL_PARKED_M
      const ocean = meshRef.current
      if (ocean) ocean.visible = false
      canvas.dataset.reveal = 'done'
      canvas.dataset.programs = String(gl.info.programs?.length ?? 0)
      markRevealSeen()
      invalidate()
    }

    const tickRise = (now: number) => {
      if (cancelled) return
      const progress = revealProgressAt(now - riseStart, duration)
      const height = revealHeightAt(progress, sweepStart)
      reveal.uniforms.uRevealHeight.value = height
      const ocean = meshRef.current
      if (ocean) ocean.position.y = height
      oceanUniforms.uOceanTime.value = (now - startedAt) / 1000
      invalidate()
      if (progress >= 1) {
        finish()
        return
      }
      raf = requestAnimationFrame(tickRise)
    }

    const beginRise = async () => {
      if (phase !== 'ocean' || cancelled) return
      phase = 'rising'
      window.clearInterval(settledTimer)
      try {
        await warmupScene(gl, scene, camera)
      } catch {
        // Compile errors surface on real frames; the sweep still runs.
      }
      if (cancelled) return
      // Start just above the live town top: both the ceiling and the
      // measured start read full cream, so the snap is invisible.
      sweepStart = revealStartFor(measureContentTop(meshesRef.current))
      reveal.uniforms.uRevealHeight.value = sweepStart
      const ocean = meshRef.current
      if (ocean) ocean.position.y = sweepStart
      // The flag flips when the sweep actually starts, so specs waiting on
      // `rising` land mid-sweep instead of inside the warm-up.
      canvas.dataset.reveal = 'rising'
      if (duration <= 0) {
        finish()
        return
      }
      riseStart = performance.now()
      raf = requestAnimationFrame(tickRise)
    }

    const mountVersion = versionForMeshes(meshesRef.current)
    settledTimer = window.setInterval(() => {
      if (cancelled || phase !== 'ocean') return
      const current = versionForMeshes(meshesRef.current)
      const now = performance.now()
      if (current !== lastVersion) {
        lastVersion = current
        lastChange = now
      }
      const hasContent = current !== undefined && (current !== mountVersion || current > 0)
      const settled = hasContent && now - lastChange >= REVEAL_SETTLE_WAIT_MS
      if (settled || now - startedAt >= REVEAL_WAIT_CAP_MS) void beginRise()
    }, 120)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearInterval(settledTimer)
    }
    // The sweep runs once per canvas mount: live registry reads go through
    // the ref, and the town meshes map is stable, so resubscribing would only
    // restart a finished reveal.
  }, [gl, scene, camera, invalidate])

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, REVEAL_SETTLE_M, 0]}
      castShadow={false}
      receiveShadow={false}
      visible={false}
    />
  )
}
