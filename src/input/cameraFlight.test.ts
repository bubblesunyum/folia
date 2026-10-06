import { describe, expect, it } from 'vitest'
import { PLACE_FLIGHT_MS } from '../motion/flight'
import { YAW_SNAP_RAD } from '../motion/orbitLimits'
import {
  beginCameraFlight,
  currentCameraFlight,
  PLACE_SWAP_PROGRESS,
  planPlaceFlight,
  poseForPlaceCamera,
  snapshotPlaceCamera,
  stepPlaceFlight,
} from './cameraFlight'
import {
  baseAzimuthDeg,
  type CameraPose,
  CORTICO_PRESET,
  casePresetForSlug,
  poseForPath,
  TOWN_PRESET,
  yawStatusForOffset,
} from './cameraPresets'

describe('cameraFlight', () => {
  it('bumps the generation on claim', () => {
    const before = currentCameraFlight()
    const claimed = beginCameraFlight()
    expect(claimed).toBe(before + 1)
    expect(currentCameraFlight()).toBe(claimed)
  })
})

/** Town pose minus its target: the flight under test starts from the town. */
function townPose(): CameraPose {
  return poseForPath('/')
}

describe('planPlaceFlight', () => {
  it('flies full motion over PLACE_FLIGHT_MS and cuts under reduced motion', () => {
    const full = planPlaceFlight(townPose(), '/cortico', 1000, false)
    expect(full.durationMs).toBe(PLACE_FLIGHT_MS)
    expect(full.key).toBe('/cortico')
    expect(full.to).toEqual(poseForPath('/cortico'))
    expect(full.flight).toBe(currentCameraFlight())
    const cut = planPlaceFlight(townPose(), '/cortico', 1000, true)
    expect(cut.durationMs).toBe(0)
  })

  it('keys case vantages separately so swaps refly', () => {
    expect(planPlaceFlight(townPose(), '/cortico/platform', 0, false).key).toBe('/cortico/platform')
  })
})

describe('stepPlaceFlight', () => {
  it('eases from the live pose to the preset and lands there', () => {
    const from = townPose()
    const flight = planPlaceFlight(from, '/cortico', 1000, false)
    const at0 = stepPlaceFlight(flight, 1000)
    expect(at0.pose.position).toEqual(from.position)
    expect(at0.settled).toBe(false)
    expect(at0.swapped).toBe(false)
    expect(at0.superseded).toBe(false)
    const mid = stepPlaceFlight(flight, 1000 + PLACE_FLIGHT_MS / 2)
    // Ease-out: most of the way there by mid-flight, and the swap tripped.
    const total = Math.hypot(
      flight.to.position[0] - from.position[0],
      flight.to.position[1] - from.position[1],
      flight.to.position[2] - from.position[2],
    )
    const remaining = Math.hypot(
      flight.to.position[0] - mid.pose.position[0],
      flight.to.position[1] - mid.pose.position[1],
      flight.to.position[2] - mid.pose.position[2],
    )
    expect(remaining).toBeLessThan(total / 2)
    expect(mid.swapped).toBe(true)
    expect(mid.settled).toBe(false)
    const landed = stepPlaceFlight(flight, 1000 + PLACE_FLIGHT_MS)
    expect(landed.pose).toEqual(flight.to)
    expect(landed.settled).toBe(true)
    expect(landed.swapped).toBe(true)
  })

  it('trips the mid-flight swap exactly at the swap point', () => {
    const flight = planPlaceFlight(townPose(), '/cortico', 1000, false)
    // Swap reads raw progress (linear in time): just before the point it
    // holds, just after it trips.
    const duration = PLACE_FLIGHT_MS
    const before = stepPlaceFlight(flight, 1000 + duration * (PLACE_SWAP_PROGRESS - 0.01))
    const after = stepPlaceFlight(flight, 1000 + duration * (PLACE_SWAP_PROGRESS + 0.01))
    expect(before.swapped).toBe(false)
    expect(after.swapped).toBe(true)
  })

  it('lands the cut at once under reduced motion', () => {
    const flight = planPlaceFlight(townPose(), '/cortico', 1000, true)
    const step = stepPlaceFlight(flight, 1000)
    expect(step.pose).toEqual(flight.to)
    expect(step.settled).toBe(true)
    expect(step.swapped).toBe(true)
  })

  it('yields when another driver claims the camera', () => {
    const flight = planPlaceFlight(townPose(), '/cortico', 1000, false)
    beginCameraFlight()
    const step = stepPlaceFlight(flight, 1500)
    expect(step.superseded).toBe(true)
    expect(step.settled).toBe(false)
  })

  it('lands inside the vantage yaw window (orbit stays bounded)', () => {
    const flight = planPlaceFlight(townPose(), '/cortico', 1000, false)
    const landed = stepPlaceFlight(flight, 1000 + PLACE_FLIGHT_MS)
    const offset: readonly [number, number, number] = [
      landed.pose.position[0] - landed.pose.target[0],
      landed.pose.position[1] - landed.pose.target[1],
      landed.pose.position[2] - landed.pose.target[2],
    ]
    expect(yawStatusForOffset(offset, '/cortico', YAW_SNAP_RAD).outOfRange).toBe(false)
    expect(landed.pose.fov).toBe(CORTICO_PRESET.fov)
  })
})

describe('serializable place camera ({place, offset})', () => {
  it('snapshots the live camera off its preset target', () => {
    const state = snapshotPlaceCamera('/cortico', CORTICO_PRESET.position)
    expect(state.place).toBe('cortico')
    expect(state.offset).toEqual([
      CORTICO_PRESET.position[0] - CORTICO_PRESET.target[0],
      CORTICO_PRESET.position[1] - CORTICO_PRESET.target[1],
      CORTICO_PRESET.position[2] - CORTICO_PRESET.target[2],
    ])
    expect(snapshotPlaceCamera('/', TOWN_PRESET.position).place).toBe('town')
  })

  it('restores the preset pose from its own snapshot', () => {
    const state = snapshotPlaceCamera('/cortico', CORTICO_PRESET.position)
    expect(poseForPlaceCamera(state)).toEqual(poseForPath('/cortico'))
    const town = snapshotPlaceCamera('/', TOWN_PRESET.position)
    expect(poseForPlaceCamera(town)).toEqual(poseForPath('/'))
  })

  it('restores case vantages through their slug', () => {
    const preset = casePresetForSlug('platform')
    if (preset === null) throw new Error('cameraFlight.test: no vantage for platform')
    const state = snapshotPlaceCamera('/cortico/platform', preset.position)
    expect(state.place).toBe('case')
    expect(poseForPlaceCamera(state, 'platform')).toEqual(poseForPath('/cortico/platform'))
    expect(() => poseForPlaceCamera(state)).toThrow(/no vantage/)
    expect(() => poseForPlaceCamera(state, 'nope')).toThrow(/no vantage/)
  })

  it('confines a wild offset to the yaw window and the zoom limits', () => {
    const behind: readonly [number, number, number] = [
      CORTICO_PRESET.target[0],
      CORTICO_PRESET.target[1] + 10,
      CORTICO_PRESET.target[2] - 200,
    ]
    const state = snapshotPlaceCamera('/cortico', behind)
    const pose = poseForPlaceCamera(state)
    const offset: readonly [number, number, number] = [
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    ]
    expect(yawStatusForOffset(offset, '/cortico', YAW_SNAP_RAD).outOfRange).toBe(false)
    const distance = Math.hypot(offset[0], offset[1], offset[2])
    expect(distance).toBeLessThanOrEqual(CORTICO_PRESET.maxDistance)
    expect(distance).toBeGreaterThanOrEqual(CORTICO_PRESET.minDistance)
    expect(baseAzimuthDeg(CORTICO_PRESET)).toBeCloseTo(baseAzimuthDeg(TOWN_PRESET), 0)
  })
})
