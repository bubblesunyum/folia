// Place flights on route change (fol-l7d.8, D-007/D-008): a link click,
// back or forward lands the camera on the route's preset vantage — position,
// target and fov easing together on the one camera easing every rise and
// flight shares (motion/flight). Town-level canvas taps do nothing by design
// (D-021 keeps / → /cortico via links): this never reads taps, only the route.
//
// The flight plans from the live pose in the first frame after the vantage
// key changes — planning in the frame, not the effect, means a panel dolly
// that claims the camera on the same commit always claims first, so opening
// or closing a case yields to the panel reframe through the shared generation
// (beginCameraFlight/currentCameraFlight) and never fights it. User zoom
// claims the same generation mid-flight and takes the camera. Query and hash
// ride along blind (the key strips them), so QA sessions never refly.
// Reduced motion cuts: the first step already lands. At rest — no flight, a
// landed flight, a yielded one — this invalidates nothing (D-056), so
// ?sway=off keeps resting at zero draws.
//
// The mid-flight LOD swap (D-050) needs no work here: high joins on the
// vantage mount through BlenderAsset's latched stream (route-driven, warmed
// by hover preload), and this motion masks it — PLACE_SWAP_PROGRESS stays the
// documented intent point with no consumer in the rig.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import type { PerspectiveCamera, Vector3 } from 'three'
import { setCanvasHook } from '../testHooks'
import { type PlaceFlight, planPlaceFlight, stepPlaceFlight } from './cameraFlight'
import { type CameraPose, placeFlightKey } from './cameraPresets'
import { readReducedMotion } from './intent'

interface ControlsLike {
  target: Vector3
  update: () => void
}

/** Below this the camera already sits on its vantage: hold, don't refly. */
const SETTLE_M = 0.001
const SETTLE_FOV = 0.001

function posesClose(from: CameraPose, to: CameraPose): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs((from.position[i] as number) - (to.position[i] as number)) > SETTLE_M) return false
    if (Math.abs((from.target[i] as number) - (to.target[i] as number)) > SETTLE_M) return false
  }
  return Math.abs(from.fov - to.fov) <= SETTLE_FOV
}

/**
 * Flies the camera to the route's preset vantage on route change. Plans and
 * steps in the frame loop with a generation claim; yields the moment another
 * driver (panel dolly, user zoom) claims the camera after planning.
 */
export function PlaceFlightRig() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const { pathname } = useLocation()
  const key = placeFlightKey(pathname)
  const rig = useRef({ key: null as string | null, flight: null as PlaceFlight | null })
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  // Wake the demand loop on route change (and mount): frames only run on
  // demand, and the flight below plans in its first frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the wake-up trigger
  useEffect(() => {
    invalidate()
  }, [invalidate, key])

  useFrame(() => {
    const r = rig.current
    if (r.key !== key) {
      // A new vantage — push, replace or back/forward. Engage from the live
      // pose; planning claims the camera, so an in-flight zoom tween yields
      // and the next zoom resumes from where the flight leaves the camera.
      r.key = key
      const live = controlsRef.current?.target
      const from: CameraPose = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: live ? [live.x, live.y, live.z] : [0, 2, 0],
        fov: (camera as PerspectiveCamera).fov,
      }
      const flight = planPlaceFlight(from, pathname, performance.now(), readReducedMotion())
      // Already on the vantage (a mount at /, a same-vantage remount): the
      // claim above still cancels a stale zoom tween, but there is nothing
      // to fly, so hold without ever invalidating again.
      r.flight = posesClose(from, flight.to) ? null : flight
    }
    const flight = r.flight
    if (flight === null) return
    const step = stepPlaceFlight(flight, performance.now())
    if (step.superseded) {
      // A panel dolly or user zoom claimed the camera after planning: yield,
      // hold the line. The claimer owns the next frames.
      r.flight = null
      return
    }
    camera.position.set(step.pose.position[0], step.pose.position[1], step.pose.position[2])
    const target = controlsRef.current?.target
    if (target) {
      target.set(step.pose.target[0], step.pose.target[1], step.pose.target[2])
    }
    const persp = camera as PerspectiveCamera
    if (persp.fov !== step.pose.fov) {
      persp.fov = step.pose.fov
      persp.updateProjectionMatrix()
    }
    controlsRef.current?.update()
    // The readout measures the camera, so specs observe real motion — the
    // same contract ZoomRig keeps.
    if (target) {
      setCanvasHook(gl.domElement, 'zoom', camera.position.distanceTo(target).toFixed(2))
    }
    if (step.settled) {
      r.flight = null
      return
    }
    invalidate()
  })

  return null
}
