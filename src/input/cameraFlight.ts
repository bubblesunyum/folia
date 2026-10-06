// Camera-flight coordination (fol-bsw): whoever drives the camera bumps the
// generation, and tween owners yield when it moves under them. The panel
// vantage dolly (PanelCameraRig) and user zoom (ZoomRig) share one camera
// with no other channel between them; without this a panel dolly and a zoom
// tween would write the camera on alternate frames. Pure and three-free.

import { flightAt, flightDurationMs, PLACE_FLIGHT_MS, tweenProgress } from '../motion/flight'
import { confineOffsetToWindow, windowForPreset } from '../motion/orbitLimits'
import {
  baseAzimuthDeg,
  type CameraPlace,
  type CameraPose,
  placeFlightKey,
  placeForPath,
  poseForPath,
  presetForPath,
  presetForRestore,
} from './cameraPresets'

let flight = 0

/** Claim the camera: cancels in-flight tweens owned by others. */
export function beginCameraFlight(): number {
  flight += 1
  return flight
}

/** The current generation; tween owners compare against their start. */
export function currentCameraFlight(): number {
  return flight
}

/**
 * Mid-flight LOD swap point (D-050, fol-l7d.8): past this progress the rig
 * mounts the hood's high stream, while the camera is still moving to mask
 * it. Loading itself stays BlenderAsset's hover preload plus its latched
 * stream — never reimplemented here — this only names when.
 */
export const PLACE_SWAP_PROGRESS = 0.5

/** One place flight: the live pose to the path's preset, on the one easing. */
export interface PlaceFlight {
  /** Vantage identity at plan time; a new key means refly (back/forward). */
  key: string
  from: CameraPose
  to: CameraPose
  /** ms on the caller's clock; 0 under reduced motion, which is a cut. */
  start: number
  durationMs: number
  /** Generation claim: another driver cancels this, like zoom and dolly. */
  flight: number
}

/**
 * Plan the flight to a path's preset vantage (D-007/D-008, fol-l7d.8):
 * position, target and fov ease together over PLACE_FLIGHT_MS with the one
 * easing every rise and flight shares; reduced motion cuts (duration 0, so
 * the first step already lands). The destination sits on its preset, inside
 * its yaw window by construction. Claims the camera on plan.
 */
export function planPlaceFlight(
  from: CameraPose,
  pathname: string,
  start: number,
  reducedMotion: boolean,
): PlaceFlight {
  return {
    key: placeFlightKey(pathname),
    from,
    to: poseForPath(pathname),
    start,
    durationMs: flightDurationMs(PLACE_FLIGHT_MS, reducedMotion),
    flight: beginCameraFlight(),
  }
}

export interface PlaceFlightStep {
  pose: CameraPose
  settled: boolean
  /**
   * Progress past the swap point: mount the high stream now (see
   * PLACE_SWAP_PROGRESS). A cut lands swapped at once.
   */
  swapped: boolean
  /** Another driver claimed the camera after planning: yield, hold the line. */
  superseded: boolean
}

/**
 * One eased step of a planned place flight. Tuple math, no camera: the rig
 * writes the pose and invalidates while unsettled, and rests (D-056) once
 * the flight lands — exactly the zoom tween's contract.
 */
export function stepPlaceFlight(
  flight: PlaceFlight,
  now: number,
  currentFlight: number = currentCameraFlight(),
): PlaceFlightStep {
  if (currentFlight !== flight.flight) {
    return { pose: flight.from, settled: false, swapped: false, superseded: true }
  }
  const progress = tweenProgress(flight.start, now, flight.durationMs)
  const at = (from: number, to: number): number => flightAt(from, to, progress)
  const pose: CameraPose = {
    position: [
      at(flight.from.position[0], flight.to.position[0]),
      at(flight.from.position[1], flight.to.position[1]),
      at(flight.from.position[2], flight.to.position[2]),
    ],
    target: [
      at(flight.from.target[0], flight.to.target[0]),
      at(flight.from.target[1], flight.to.target[1]),
      at(flight.from.target[2], flight.to.target[2]),
    ],
    fov: at(flight.from.fov, flight.to.fov),
  }
  return {
    pose,
    settled: progress >= 1,
    swapped: progress >= PLACE_SWAP_PROGRESS,
    superseded: false,
  }
}

/**
 * Serializable camera state: the place plus the orbit offset off its preset
 * target, in metres. Tuples only — it crosses the router and the SSR
 * boundary (D-047), and back/forward restores through it.
 */
export interface PlaceCameraState {
  place: CameraPlace
  offset: readonly [number, number, number]
}

/** Snapshot the live camera position against its path's preset target. */
export function snapshotPlaceCamera(
  pathname: string,
  position: readonly [number, number, number],
): PlaceCameraState {
  const target = presetForPath(pathname).target
  return {
    place: placeForPath(pathname),
    offset: [position[0] - target[0], position[1] - target[1], position[2] - target[2]],
  }
}

/**
 * Restore a pose from serializable state: the place's preset target plus the
 * offset, confined to the preset's yaw window (D-008) and its zoom limits, so
 * a restored camera can never park outside the orbit it returns to. A case
 * needs its slug — without a known one it throws instead of aiming nowhere.
 */
export function poseForPlaceCamera(state: PlaceCameraState, slug?: string): CameraPose {
  const preset = presetForRestore(state.place, slug)
  const window = windowForPreset(preset, baseAzimuthDeg(preset))
  const confined = confineOffsetToWindow(state.offset, window)
  const length = Math.hypot(confined[0], confined[1], confined[2])
  const clampedLength = Math.min(Math.max(length, preset.minDistance), preset.maxDistance)
  const scale = length === 0 ? 0 : clampedLength / length
  const position: readonly [number, number, number] = [
    preset.target[0] + confined[0] * scale,
    preset.target[1] + confined[1] * scale,
    preset.target[2] + confined[2] * scale,
  ]
  return { position, target: preset.target, fov: preset.fov }
}
