import { useFrame, useThree } from '@react-three/fiber'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { DirectionalLight } from 'three'
import { debug, renderConfig } from '../debug'
import { runBurst } from '../perf/bench'
import {
  applyTierToRenderConfig,
  classifyFrameWindow,
  type EffectiveTierConfig,
  FRAME_WINDOW,
  getTierId,
  needsShadowMapResize,
  parseTierCeilings,
  priorTierForGpu,
  type QualityTierId,
  readCachedTier,
  rendererStringFor,
  resolveEffectiveTier,
  setTierId,
  shouldStressDowngrade,
  shouldStressUpgrade,
  stepTier,
  type TierCeilings,
  tierCacheKey,
  writeCachedTier,
} from '../perf/qualityTiers'
import { Effects } from '../renderer/Effects'
import { Viewport } from '../renderer/Viewport'
import { shadowSunRef } from '../scene/Lights'
import { LookDevScene } from '../scene/LookDevScene'
import { TownBatches } from '../scene/TownBatches'
import { LookProvider } from '../time/LookProvider'
import { RevealDriver } from './RevealDriver'

const PerfHud = lazy(() =>
  import('../perf/PerfHud').then((module) => ({ default: module.PerfHud })),
)

/**
 * Everything WebGL, behind the client-only lazy boundary in `App`. three,
 * R3F and the scene never enter the initial module graph (D-047).
 */
export function TownCanvas({ onSky }: { onSky: () => void }) {
  return (
    <Viewport onFirstFrame={onSky}>
      <LookProvider>
        <TierRig />
        <TownBatches>
          <LookDevScene />
          {/* Outside every Suspense boundary: sky plus the cream ocean paint
              before the town streams, and the driver sweeps the reveal once
              it settles (D-018). */}
          <RevealDriver />
        </TownBatches>
        <Effects />
      </LookProvider>
      {debug.hud && (
        <Suspense fallback={null}>
          <PerfHud />
        </Suspense>
      )}
    </Viewport>
  )
}

// The saturated frames per idle stress burst: ~0.25 s of hitch, once per
// page load, while the finished reveal sits still.
const STRESS_FRAMES = 120
const STRESS_WARMUP = 30
const REVEAL_POLL_MS = 500
const POST_REVEAL_IDLE_MS = 1500

// StrictMode mounts twice in dev: the burst runs once per page load, and the
// second mount re-evaluates honestly at the new rung instead of bursting again.
let stressProbed = false

// The tier ladder's search string, window-guarded for the SSR boundary check.
function tierSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

// Writes one rung's sun state through the sun Lights published: intensity 0/1
// plus a map realloc when lit — never shadowMap.enabled (D-043).
function applyShadowTier(sun: DirectionalLight | null, effective: EffectiveTierConfig): void {
  if (sun === null) return
  sun.shadow.intensity = effective.shadowIntensity
  if (needsShadowMapResize(sun.shadow.mapSize.x, effective.tier)) {
    sun.shadow.mapSize.set(effective.shadowMapSize, effective.shadowMapSize)
    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }
  }
}

/**
 * The tier probe's thin rig (D-036): places the ladder from cache-or-prior on
 * mount, then one post-reveal idle stress burst for upgrades plus a continuous
 * frame-time watch for downgrades. `?perf=base` pins the bench config, so the
 * rig no-ops there and D-063 stays comparable.
 *
 * Applying a rung moves the tier store (Viewport, Effects and MaterialLook
 * subscribe through `useEffectiveTier`), writes the shared render flags (the
 * URL switches' successor — Lights and WaterReflection read them per frame),
 * and sets the sun's `shadow.intensity` plus a map realloc when lit through
 * the sun Lights published (never `shadowMap.enabled`, D-043). MaterialLook
 * owns the only `applyLook` call and reads the tier-effective bloom itself,
 * so the fake-glow scale follows the rung with a single writer. DPR and the
 * frame cap ride the store through Viewport; bloom rides it through Effects.
 */
function TierRig() {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  // Parsed once, as the state initializer: assigning a ref during render
  // re-parses under StrictMode's double render.
  const [ceilings] = useState<TierCeilings>(() => parseTierCeilings(tierSearch()))
  const cacheKeyRef = useRef<string | null>(null)
  const deltasRef = useRef<number[]>([])

  const applyTier = (id: QualityTierId): void => {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
    const effective = resolveEffectiveTier(id, ceilings, userAgent)
    setTierId(id)
    applyTierToRenderConfig(renderConfig, effective)
    applyShadowTier(shadowSunRef.current, effective)
    if (cacheKeyRef.current !== null) writeCachedTier(window.localStorage, cacheKeyRef.current, id)
    invalidate()
  }
  const applyTierRef = useRef(applyTier)
  applyTierRef.current = applyTier

  // Cache-or-prior placement, first: an earlier sibling than the scene
  // subtree, so the store lands before MaterialLook's first apply.
  useEffect(() => {
    if (renderConfig.budget) return
    const raw = gl.getContext() as WebGL2RenderingContext | null
    const renderer = raw ? rendererStringFor(raw) : 'unknown'
    const key = tierCacheKey(renderer, window.screen.width, window.screen.height)
    cacheKeyRef.current = key
    const initial =
      readCachedTier(window.localStorage, key) ?? priorTierForGpu(renderer, window.screen.width)
    applyTierRef.current(initial)
  }, [gl])

  // One post-reveal idle burst: upgrades on headroom, downgrades past the gate.
  // A hidden tab parks the burst on `visibilitychange` instead of dropping it:
  // the early return below must not consume the probe.
  useEffect(() => {
    if (renderConfig.budget || stressProbed) return
    const canvas = gl.domElement
    let idleTimer = 0
    let onVisible: (() => void) | null = null
    const runBurstOnce = (): void => {
      stressProbed = true
      try {
        const raw = gl.getContext() as WebGL2RenderingContext | null
        if (!raw) return
        const result = runBurst(raw, STRESS_FRAMES, STRESS_WARMUP)
        const id = getTierId()
        if (shouldStressDowngrade(result.ms, id)) applyTierRef.current(stepTier(id, -1))
        else if (shouldStressUpgrade(result.ms, id)) applyTierRef.current(stepTier(id, 1))
      } catch {
        // Indicative only: the ladder stands where the placement put it.
      }
    }
    const armIdle = (): void => {
      idleTimer = window.setTimeout(() => {
        if (document.hidden) {
          onVisible = () => {
            if (document.hidden) return
            if (onVisible !== null) document.removeEventListener('visibilitychange', onVisible)
            onVisible = null
            runBurstOnce()
          }
          document.addEventListener('visibilitychange', onVisible)
          return
        }
        runBurstOnce()
      }, POST_REVEAL_IDLE_MS)
    }
    const pollTimer = window.setInterval(() => {
      if (canvas.dataset.reveal !== 'done') return
      window.clearInterval(pollTimer)
      armIdle()
    }, REVEAL_POLL_MS)
    return () => {
      window.clearInterval(pollTimer)
      window.clearTimeout(idleTimer)
      if (onVisible !== null) document.removeEventListener('visibilitychange', onVisible)
    }
  }, [gl])

  // Continuous frame-time watch: steps down on sustained missed vsyncs while
  // actively rendering. Never invalidates, so it adds no frames of its own;
  // ambient ~30 Hz windows read idle and never fire.
  useFrame((_, delta) => {
    if (renderConfig.budget) return
    const deltas = deltasRef.current
    deltas.push(delta * 1000)
    if (deltas.length < FRAME_WINDOW) return
    const verdict = classifyFrameWindow(deltas)
    deltas.length = 0
    if (verdict !== 'janky') return
    const id = getTierId()
    if (id === 'low') return
    applyTierRef.current(stepTier(id, -1))
  })

  return null
}
