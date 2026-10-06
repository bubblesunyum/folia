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

import { useFrame, useThree } from '@react-three/fiber'
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
  // Shared sweep state between the mount effect (settle wait, warm-up) and
  // the frame loop below. Refs, not state: every write here already
  // invalidates explicitly, and re-rendering mid-sweep would restart nothing
  // but cost a commit.
  const cancelledRef = useRef(false)
  const phaseRef = useRef<RevealPhase>('ocean')
  const armedRef = useRef(false)
  const riseStartRef = useRef(0)
  const sweepStartRef = useRef(REVEAL_START_M)
  const durationRef = useRef(0)
  const startedAtRef = useRef(0)
  const finishRef = useRef(() => {})

  // The sweep rides the R3F frame loop (D-056): each rendered frame advances
  // the reveal height while rising and invalidates for the next one — the
  // self-perpetuating demand-mode loop from ZoomRig. At rest (the ocean wait
  // or done) this invalidates nothing, so ?sway=off still rests at zero
  // draws. Values, not programs: one uniform write per frame, never a
  // recompile.
  //
  // Why not the ambient scheduler (D-073): it freezes while a panel is open
  // or being read, when the tab hides, and under reduced motion — and the
  // reveal must finish through all of those (reduced motion cuts straight to
  // done, the wait cap still fires behind a panel). Its ~30 Hz cadence would
  // also step the 2.5 s sweep. The settle wait below stays on a bare 120 ms
  // interval for the same reason in miniature: it polls the registry without
  // drawing, while a useFrame poll would need an invalidate per check and
  // burn frames through the whole wait.
  useFrame(() => {
    if (cancelledRef.current || phaseRef.current !== 'rising' || !armedRef.current) return
    const now = performance.now()
    const progress = revealProgressAt(now - riseStartRef.current, durationRef.current)
    const height = revealHeightAt(progress, sweepStartRef.current)
    reveal.uniforms.uRevealHeight.value = height
    const ocean = meshRef.current
    if (ocean) ocean.position.y = height
    oceanUniforms.uOceanTime.value = (now - startedAtRef.current) / 1000
    if (progress >= 1) {
      finishRef.current()
      return
    }
    invalidate()
  })

  useEffect(() => {
    const owned = { geometry, material }
    return () => {
      owned.geometry.dispose()
      owned.material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const canvas = gl.domElement
    cancelledRef.current = false
    armedRef.current = false
    let settledTimer = 0
    const startedAt = performance.now()
    startedAtRef.current = startedAt
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = revealDurationMs({
      repeat: readRepeatVisit(),
      deepLink: window.location.pathname !== '/',
      reducedMotion,
    })
    durationRef.current = duration
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
    phaseRef.current = 'ocean'
    // The batch map is pre-populated (one entry per shared material) before
    // any asset registers, so map size says nothing about content. The sweep
    // waits for a registry version past zero — a real asset landing, before
    // or after this effect ran (child effects register first, so a
    // synchronous fast load is already past zero at mount) — and falls back
    // to the wait cap when nothing ever arrives.

    const finish = () => {
      // Parked below the town the band mix is exactly zero: still renders sit
      // on the authored look, and the ocean hides on the same tick.
      phaseRef.current = 'done'
      armedRef.current = false
      reveal.uniforms.uRevealHeight.value = REVEAL_PARKED_M
      const ocean = meshRef.current
      if (ocean) ocean.visible = false
      canvas.dataset.reveal = 'done'
      canvas.dataset.programs = String(gl.info.programs?.length ?? 0)
      markRevealSeen()
      invalidate()
    }
    finishRef.current = finish

    const beginRise = async () => {
      if (phaseRef.current !== 'ocean' || cancelledRef.current) return
      phaseRef.current = 'rising'
      window.clearInterval(settledTimer)
      try {
        await warmupScene(gl, scene, camera)
      } catch {
        // Compile errors surface on real frames; the sweep still runs.
      }
      if (cancelledRef.current) return
      // Start just above the live town top: both the ceiling and the
      // measured start read full cream, so the snap is invisible.
      const sweepStart = revealStartFor(measureContentTop(meshesRef.current))
      sweepStartRef.current = sweepStart
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
      // Arm the frame loop: the invalidate below draws the first rising
      // frame, and each rising frame invalidates the next until done.
      riseStartRef.current = performance.now()
      armedRef.current = true
      invalidate()
    }

    const mountVersion = versionForMeshes(meshesRef.current)
    settledTimer = window.setInterval(() => {
      if (cancelledRef.current || phaseRef.current !== 'ocean') return
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
      cancelledRef.current = true
      armedRef.current = false
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
