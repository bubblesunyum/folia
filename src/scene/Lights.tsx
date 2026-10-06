import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type DirectionalLight, Vector3 } from 'three'
import { versionForMeshes } from '../assets/townVersion'
import { renderConfig } from '../debug'
import { groupStateUploads } from '../materials/groupState'
import { useQualityTierId } from '../perf/qualityTiers'
import { SHADOW_FITS } from '../perf/renderConfig'
import { useLook } from '../time/lookContext'
import {
  quantizeExtent,
  resolveShadowRefresh,
  SHADOW_MAP_SIZE,
  type ShadowInvalidationState,
  shadowNeedsRefresh,
  snapShadowToTexels,
} from './shadowFit'
import { useTownBatches } from './TownBatches'

// The sun, published for the tier rig: TierRig writes the rung's shadow
// intensity and map size through this instead of traversing the scene.
export const shadowSunRef: { current: DirectionalLight | null } = { current: null }

const DISTANCE = 40

// Unsnapped base the snap derives from each frame: the sun direction at full
// distance, aim at the origin. Rebuilt per frame so R3F prop writes and the
// snap can never observe each other's deltas (fol-jc9).
const _snapBase = { position: new Vector3(), target: new Vector3() }

// Member-wise copy between shadow-invalidation states: the tuples are fixed
// triples mutated in place, so steady frames allocate nothing (fol-o3v).
function copyShadowState(target: ShadowInvalidationState, source: ShadowInvalidationState): void {
  target.camera[0] = source.camera[0]
  target.camera[1] = source.camera[1]
  target.camera[2] = source.camera[2]
  target.sun[0] = source.sun[0]
  target.sun[1] = source.sun[1]
  target.sun[2] = source.sun[2]
  target.daylight = source.daylight
  target.look = source.look
  target.liftUploads = source.liftUploads
  target.content = source.content
}

/**
 * The sun and the moon, both always in the scene so the light count (and every
 * program) stays fixed as the time of day moves (D-038). The sun is first and
 * casts the only shadow, so it's `directionalLights[0]` in the foliage feature.
 *
 * Spike 5 (D-041): the shadow frustum is a quantized, texel-snapped fit —
 * `?fit=vantage` for the tight one, town by default — at 2048 PCF, refreshed
 * on demand on the live policy (fol-kes.17): camera, sun, lift and look moves
 * issue one `needsUpdate`, while ambient-only frames skip the shadow pass
 * (sway detaches up to 5 cm, accepted). `?shadows=static` freezes the map
 * instead, the D-041 fallback: free while idle, but sway and lift detach.
 */
export function Lights() {
  const { look, sun, moon } = useLook()
  const { meshes } = useTownBatches()
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const sunRef = useRef<DirectionalLight>(null)
  // The ladder rung: a tier step re-runs the shadow-policy effect below, so a
  // downgrade freezes the map through the same path as a sun move.
  const tierId = useQualityTierId()
  // Last pass's sun state: sunset issues one final shadow refresh, then the
  // map holds frozen until sunrise. Starts up so a mount at night settles
  // the same way (one refresh, then frozen).
  const wasSunUpRef = useRef(true)
  const extent = quantizeExtent(SHADOW_FITS[renderConfig.shadowFit])
  const at = (d: readonly number[]) => d.map((v) => v * DISTANCE) as [number, number, number]

  // The target's matrix only updates inside the scene graph.
  useEffect(() => {
    const light = sunRef.current
    if (!light) return
    shadowSunRef.current = light
    scene.add(light.target)
    return () => {
      shadowSunRef.current = null
      scene.remove(light.target)
    }
  }, [scene])

  // R3F sets the ortho bounds from props but doesn't re-derive the projection.
  useEffect(() => {
    const light = sunRef.current
    if (!light) return
    light.shadow.camera.updateProjectionMatrix()
  }, [])

  // The shadow policy (D-041) plus the night freeze (fol-779) and the
  // ambient stillness (fol-kes.17). Static freezes the map after this frame
  // and re-freezes whenever the time of day moves the sun. Live refreshes on
  // demand instead of every frame: each look/sun invalidation issues one
  // update, camera and lift moves refresh through the per-frame dirty check
  // below, and ambient-only frames skip the pass. At daylight 0 the sun's
  // intensity is 0 and the shadow pass is pure cost (spike 5: 475k tris), so
  // sunset freezes after one final refresh and sunrise refreshes once. Tier
  // steps re-run it through the tier subscription, so a downgrade to a static
  // rung freezes the map instead of leaving autoUpdate on. Only
  // the autoUpdate/needsUpdate flags move — never castShadow or
  // shadowMap.enabled, which recompile all programs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `look` and `tierId` are the re-freeze triggers
  useEffect(() => {
    const { autoUpdate, needsRefresh } = resolveShadowRefresh(
      renderConfig.shadowPolicy,
      sun.daylight,
      wasSunUpRef.current,
    )
    wasSunUpRef.current = sun.daylight > 0
    gl.shadowMap.autoUpdate = autoUpdate
    if (needsRefresh) {
      gl.shadowMap.needsUpdate = true
      invalidate()
    }
  }, [gl, invalidate, look, sun.daylight, tierId])

  // Last per-frame shadow state: null until the first rendered frame, which
  // always refreshes. The scratch is mutated in place so steady frames
  // allocate nothing (fol-o3v).
  const lastShadowRef = useRef<ShadowInvalidationState | null>(null)
  const shadowScratchRef = useRef<ShadowInvalidationState>({
    camera: [0, 0, 0],
    sun: [0, 0, 0],
    daylight: 0,
    look: null,
    liftUploads: 0,
    content: -1,
  })

  // Texel-snapped every rendered frame, so a moving sun or a tracking frustum
  // never shimmers; static otherwise, by construction. Snaps from the
  // unsnapped base each frame, so the target can't walk across sun changes.
  // Then the ambient stillness (fol-kes.17): on the live policy while the sun
  // is up, frames that moved the camera, sun, look, lift or town content
  // issue one shadow update, and ambient-only frames leave `needsUpdate`
  // down. Content arrival counts: late-streaming assets would otherwise cast
  // no shadows until the next camera move. Static and
  // night stay frozen: the effect above owns their refreshes.
  useFrame(({ camera }) => {
    const light = sunRef.current
    if (light) {
      _snapBase.position.set(
        sun.direction[0] * DISTANCE,
        sun.direction[1] * DISTANCE,
        sun.direction[2] * DISTANCE,
      )
      _snapBase.target.set(0, 0, 0)
      snapShadowToTexels(light, extent, _snapBase)
    }
    if (renderConfig.shadowPolicy !== 'live' || sun.daylight <= 0) return
    const scratch = shadowScratchRef.current
    scratch.camera[0] = camera.position.x
    scratch.camera[1] = camera.position.y
    scratch.camera[2] = camera.position.z
    scratch.sun[0] = sun.direction[0]
    scratch.sun[1] = sun.direction[1]
    scratch.sun[2] = sun.direction[2]
    scratch.daylight = sun.daylight
    scratch.look = look
    scratch.liftUploads = groupStateUploads
    // Unknown maps (tests) pin at -1: no content moves exist there, so the
    // field never spuriously refreshes; the town map always resolves.
    scratch.content = versionForMeshes(meshes) ?? -1
    if (shadowNeedsRefresh(lastShadowRef.current, scratch)) {
      gl.shadowMap.needsUpdate = true
    }
    const last = lastShadowRef.current
    if (!last) {
      const fresh: ShadowInvalidationState = {
        camera: [0, 0, 0],
        sun: [0, 0, 0],
        daylight: 0,
        look: null,
        liftUploads: 0,
        content: -1,
      }
      copyShadowState(fresh, scratch)
      lastShadowRef.current = fresh
    } else {
      copyShadowState(last, scratch)
    }
  })

  return (
    <>
      <directionalLight
        ref={sunRef}
        castShadow
        position={at(sun.direction)}
        intensity={look.sun.intensity * sun.daylight}
        color={look.sun.color as [number, number, number]}
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={DISTANCE * 2}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
      />
      <directionalLight
        position={at(moon.direction)}
        intensity={look.moon.intensity}
        color={look.moon.color as [number, number, number]}
      />
    </>
  )
}
