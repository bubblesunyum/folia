import { describe, expect, it } from 'vitest'
import { YAW_SNAP_RAD } from '../motion/orbitLimits'
import {
  applyCameraPresetOverride,
  baseAzimuthDeg,
  CAMERA_FRONTMATTER_KEYS,
  CORTICO_PRESET,
  casePresetForSlug,
  limitsForPath,
  parseCameraPreset,
  pathForPlace,
  placeFlightKey,
  placeForPath,
  poseForPath,
  presetForPath,
  presetForRestore,
  TOWN_PRESET,
  yawStatusForOffset,
} from './cameraPresets'

function distanceOf(preset: { position: readonly number[]; target: readonly number[] }): number {
  const [px = 0, py = 0, pz = 0] = preset.position
  const [tx = 0, ty = 0, tz = 0] = preset.target
  return Math.hypot(px - tx, py - ty, pz - tz)
}

describe('built-in presets', () => {
  it('seats the town camera where the shipped canvas puts it', () => {
    expect(TOWN_PRESET.fov).toBe(18)
    expect(TOWN_PRESET.yawRangeDeg).toEqual([0, 0])
    expect(distanceOf(TOWN_PRESET)).toBeCloseTo(80, 0)
    expect({ minDistance: TOWN_PRESET.minDistance, maxDistance: TOWN_PRESET.maxDistance }).toEqual({
      minDistance: 25,
      maxDistance: 90,
    })
  })

  it('frames the forum from the town direction at the neighborhood lens', () => {
    expect(CORTICO_PRESET.fov).toBeGreaterThanOrEqual(40)
    expect(CORTICO_PRESET.fov).toBeLessThanOrEqual(55)
    expect(CORTICO_PRESET.yawRangeDeg).toEqual([-35, 35])
    expect(distanceOf(CORTICO_PRESET)).toBeCloseTo(55, 0)
  })

  it('shares one view direction across town and cortico', () => {
    expect(baseAzimuthDeg(CORTICO_PRESET)).toBeCloseTo(baseAzimuthDeg(TOWN_PRESET), 0)
  })

  it('derives case vantages from the pedestal anchors', () => {
    for (const slug of ['platform', 'recorder', 'medley']) {
      const preset = casePresetForSlug(slug)
      expect(preset).not.toBeNull()
      if (preset === null) throw new Error(`no preset for ${slug}`)
      expect(distanceOf(preset)).toBeCloseTo(18, 0)
      expect(preset.yawRangeDeg).toEqual([-35, 35])
    }
    expect(casePresetForSlug('nope')).toBeNull()
  })
})

describe('placeForPath / presetForPath', () => {
  it('routes town, place and case paths', () => {
    expect(placeForPath('/')).toBe('town')
    expect(placeForPath('/?time=18:30')).toBe('town')
    expect(placeForPath('/cortico')).toBe('cortico')
    expect(placeForPath('/cortico/')).toBe('cortico')
    expect(placeForPath('/cortico/platform')).toBe('case')
    expect(placeForPath('/cortico/platform?time=18:30')).toBe('case')
    expect(placeForPath('/cortico/unknown')).toBe('cortico')
    expect(placeForPath('/resume')).toBe('town')
  })

  it('hands the rig per-place zoom limits', () => {
    expect(limitsForPath('/')).toEqual({ minDistance: 25, maxDistance: 90 })
    expect(limitsForPath('/cortico')).toEqual({
      minDistance: CORTICO_PRESET.minDistance,
      maxDistance: CORTICO_PRESET.maxDistance,
    })
    expect(presetForPath('/cortico/platform').target).toEqual(casePresetForSlug('platform')?.target)
  })

  it('derives one agreed yaw window for the spring, check and settle', () => {
    const townOffset = [
      TOWN_PRESET.position[0] - TOWN_PRESET.target[0],
      TOWN_PRESET.position[1] - TOWN_PRESET.target[1],
      TOWN_PRESET.position[2] - TOWN_PRESET.target[2],
    ] as const
    expect(yawStatusForOffset(townOffset, '/', YAW_SNAP_RAD).outOfRange).toBe(false)
    const far = yawStatusForOffset([0, 0, 80], '/cortico/platform', YAW_SNAP_RAD)
    expect(far.outOfRange).toBe(true)
  })
})

describe('poseForPath / pathForPlace / placeFlightKey', () => {
  it('hands the flight its art-directed pose, as tuples', () => {
    expect(poseForPath('/')).toEqual({
      position: TOWN_PRESET.position,
      target: TOWN_PRESET.target,
      fov: TOWN_PRESET.fov,
    })
    expect(poseForPath('/cortico/platform').target).toEqual(casePresetForSlug('platform')?.target)
    expect(poseForPath('/cortico/unknown')).toEqual({
      position: CORTICO_PRESET.position,
      target: CORTICO_PRESET.target,
      fov: CORTICO_PRESET.fov,
    })
  })

  it('routes places back to URLs, failing closed on a case with no slug', () => {
    expect(pathForPlace('town')).toBe('/')
    expect(pathForPlace('cortico')).toBe('/cortico')
    expect(pathForPlace('case', 'platform')).toBe('/cortico/platform')
    expect(() => pathForPlace('case')).toThrow(/needs its slug/)
    expect(() => pathForPlace('case', '')).toThrow(/needs its slug/)
  })

  it('keys flights on the vantage, blind to query and hash (back/forward safe)', () => {
    expect(placeFlightKey('/')).toBe('/')
    expect(placeFlightKey('/?time=18:30')).toBe('/')
    expect(placeFlightKey('/cortico')).toBe('/cortico')
    expect(placeFlightKey('/cortico/')).toBe('/cortico')
    expect(placeFlightKey('/cortico/platform')).toBe('/cortico/platform')
    expect(placeFlightKey('/cortico/platform?time=18:30')).toBe('/cortico/platform')
    expect(placeFlightKey('/cortico/unknown')).toBe('/cortico')
    expect(placeFlightKey('/resume')).toBe('/')
  })
})

describe('presetForRestore', () => {
  it('hands back the place preset, resolving cases through their slug', () => {
    expect(presetForRestore('town')).toEqual(TOWN_PRESET)
    expect(presetForRestore('cortico')).toEqual(CORTICO_PRESET)
    expect(presetForRestore('case', 'platform')).toEqual(casePresetForSlug('platform'))
  })

  it('throws fail-closed on a case with no known slug', () => {
    expect(() => presetForRestore('case')).toThrow(/no vantage/)
    expect(() => presetForRestore('case', '')).toThrow(/no vantage/)
    expect(() => presetForRestore('case', 'nope')).toThrow(/no vantage/)
  })
})

describe('parseCameraPreset', () => {
  it('reads no keys as no override', () => {
    expect(parseCameraPreset({ title: 'cortico' }, 'content/cortico/index.mdx')).toEqual({})
  })

  it('parses the staged cortico keys', () => {
    expect(
      parseCameraPreset(
        {
          cameraTarget: '-3.4, 3.2, 2.4',
          cameraDistance: '55',
          cameraFov: '45',
          cameraYaw: '35',
          cameraMin: '15',
          cameraMax: '75',
        },
        'content/cortico/index.mdx',
      ),
    ).toEqual({
      target: [-3.4, 3.2, 2.4],
      distance: 55,
      fov: 45,
      yawHalfRange: 35,
      minDistance: 15,
      maxDistance: 75,
    })
  })

  it('fails closed on malformed values', () => {
    expect(() => parseCameraPreset({ cameraTarget: 'x' }, 'f')).toThrow(/cameraTarget/)
    expect(() => parseCameraPreset({ cameraFov: '200' }, 'f')).toThrow(/cameraFov/)
    expect(() => parseCameraPreset({ cameraYaw: '-5' }, 'f')).toThrow(/cameraYaw/)
    expect(() => parseCameraPreset({ cameraMin: '80', cameraMax: '75' }, 'f')).toThrow(/cameraMin/)
    expect(() => parseCameraPreset({ cameraDistance: 'far' }, 'f')).toThrow(/cameraDistance/)
  })

  it('names exactly the keys staged in the MDX', () => {
    expect([...CAMERA_FRONTMATTER_KEYS].sort()).toEqual(
      ['cameraTarget', 'cameraDistance', 'cameraFov', 'cameraYaw', 'cameraMin', 'cameraMax'].sort(),
    )
  })
})

describe('applyCameraPresetOverride', () => {
  it('re-seats position along the view direction on distance/target', () => {
    const next = applyCameraPresetOverride(CORTICO_PRESET, { distance: 40 })
    expect(distanceOf(next)).toBeCloseTo(40, 6)
    expect(baseAzimuthDeg(next)).toBeCloseTo(baseAzimuthDeg(CORTICO_PRESET), 6)
  })

  it('passes through limits, fov and yaw without moving the camera', () => {
    const next = applyCameraPresetOverride(TOWN_PRESET, {
      fov: 20,
      yawHalfRange: 0,
      minDistance: 30,
      maxDistance: 80,
    })
    expect(next.position).toEqual(TOWN_PRESET.position)
    expect(next.fov).toBe(20)
    expect(next.yawRangeDeg).toEqual([0, 0])
  })
})
