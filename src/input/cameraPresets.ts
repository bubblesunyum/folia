// Per-place camera presets (spec: camera system, D-007/D-008). One preset
// per place: position, target, FOV, yaw range and zoom limits. The values
// below are the built-ins the rigs fly today; the same shape stages into
// content frontmatter (`cameraTarget/Distance/Fov/Yaw/Min/Max` on
// content/cortico/index.mdx) once the content schema accepts the optional
// keys — parseCameraPreset reads exactly those keys, so the MDX becomes the
// source with a one-line wiring in load.ts and no rig change.
//
// Town values mirror the shipped look-dev camera (Viewport fov 18 at
// [49.23, 41.38, 49.23] over [0, 2, 0], ~80 m out); the town skeleton sibling
// stages the town keys in content/index.mdx. Cortico frames the forum centre
// from the same direction at ~55 m with the neighborhood lens (D-007) and
// the ±35° orbit (D-008); case vantages stand off their pedestal anchor
// (forum-layout.json, via pedestals) at ~18 m. Gains are starting points for
// fol-j08's on-device tune, like D-060's input gains.

import { azimuthOf, yawClampStatus, yawWindow } from '../motion/orbitLimits'
import { PEDESTAL_ANCHOR_BY_SLUG } from '../panel/pedestals'

/** A place's art-directed camera: where it sits, what it frames, how far it roams. */
export interface CameraPreset {
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  fov: number
  /** Symmetric yaw range around the preset's base azimuth, in degrees. */
  yawRangeDeg: readonly [number, number]
  minDistance: number
  maxDistance: number
}

/** The town overview: long lens, fixed yaw, the existing zoom limits. */
export const TOWN_PRESET: CameraPreset = {
  position: [49.23, 41.38, 49.23],
  target: [0, 2, 0],
  fov: 18,
  yawRangeDeg: [0, 0],
  minDistance: 25,
  maxDistance: 90,
}

/** Cortico place vantage: the forum centre from the town direction. */
export const CORTICO_PRESET: CameraPreset = {
  position: [30.5, 30.3, 36.3],
  target: [-3.4, 3.2, 2.4],
  fov: 45,
  yawRangeDeg: [-35, 35],
  minDistance: 15,
  maxDistance: 75,
}

/** Unit view direction of the town preset: every vantage shares it. */
const TOWN_VIEW_DIR: readonly [number, number, number] = (() => {
  const dx = TOWN_PRESET.position[0] - TOWN_PRESET.target[0]
  const dy = TOWN_PRESET.position[1] - TOWN_PRESET.target[1]
  const dz = TOWN_PRESET.position[2] - TOWN_PRESET.target[2]
  const len = Math.hypot(dx, dy, dz)
  return [dx / len, dy / len, dz / len]
})()

/** Stand-off for a case vantage from its pedestal anchor, in metres. */
export const CASE_VANTAGE_DISTANCE = 18

/** A case-study vantage: its pedestal anchor from the town direction. */
export function casePresetForSlug(slug: string): CameraPreset | null {
  const anchor = PEDESTAL_ANCHOR_BY_SLUG[slug as keyof typeof PEDESTAL_ANCHOR_BY_SLUG]
  if (anchor === undefined) return null
  return {
    position: [
      anchor[0] + TOWN_VIEW_DIR[0] * CASE_VANTAGE_DISTANCE,
      anchor[1] + TOWN_VIEW_DIR[1] * CASE_VANTAGE_DISTANCE,
      anchor[2] + TOWN_VIEW_DIR[2] * CASE_VANTAGE_DISTANCE,
    ],
    target: [anchor[0], anchor[1], anchor[2]],
    fov: 50,
    yawRangeDeg: [-35, 35],
    minDistance: 8,
    maxDistance: 50,
  }
}

export type CameraPlace = 'town' | 'cortico' | 'case'

/** Path segments below the query and hash: the one parse both place routing and presets share. */
function routeSegments(pathname: string): string[] {
  const clean = pathname.split('?')[0]?.split('#')[0] ?? '/'
  return clean.split('/').filter((part) => part.length > 0)
}

/** Which place a path sits in: town, the cortico place, or a case vantage. */
export function placeForPath(pathname: string): CameraPlace {
  const parts = routeSegments(pathname)
  if (parts.length === 0) return 'town'
  if (parts[0] !== 'cortico') return 'town'
  if (parts.length >= 2 && parts[1] !== undefined && casePresetForSlug(parts[1]) !== null) {
    return 'case'
  }
  return 'cortico'
}

/** The preset for a path: case vantages resolve through the pedestal anchors. */
export function presetForPath(pathname: string): CameraPreset {
  const clean = routeSegments(pathname)
  if (clean[0] === 'cortico' && clean[1] !== undefined) {
    const preset = casePresetForSlug(clean[1])
    if (preset !== null) return preset
    return CORTICO_PRESET
  }
  if (clean[0] === 'cortico') return CORTICO_PRESET
  return TOWN_PRESET
}

/** Zoom limits for a path, for the rig's per-event lookup. */
export function limitsForPath(pathname: string): { minDistance: number; maxDistance: number } {
  const preset = presetForPath(pathname)
  return { minDistance: preset.minDistance, maxDistance: preset.maxDistance }
}

/** Base azimuth of a preset (position minus target), in degrees. */
export function baseAzimuthDeg(preset: CameraPreset): number {
  const dx = preset.position[0] - preset.target[0]
  const dz = preset.position[2] - preset.target[2]
  return (Math.atan2(dx, dz) * 180) / Math.PI
}

/**
 * Yaw spring status for an orbit offset on a path (D-008): the one derivation
 * of preset → window → clamp shared by the frame spring, the range check and
 * the release settle, so the three can never disagree on the window.
 */
export function yawStatusForOffset(
  offset: readonly [number, number, number],
  pathname: string,
  snapRad: number,
): { clamped: number; outOfRange: boolean } {
  const preset = presetForPath(pathname)
  const halfRange = (preset.yawRangeDeg[1] - preset.yawRangeDeg[0]) / 2
  const window = yawWindow(baseAzimuthDeg(preset), halfRange)
  return yawClampStatus(azimuthOf(offset), window, snapRad)
}

// Frontmatter staging (fail closed): the optional camera keys the content
// schema will accept. Flat scalars only, matching splitFrontmatter.

export const CAMERA_FRONTMATTER_KEYS = [
  'cameraTarget',
  'cameraDistance',
  'cameraFov',
  'cameraYaw',
  'cameraMin',
  'cameraMax',
] as const

export interface CameraPresetOverride {
  target?: readonly [number, number, number]
  distance?: number
  fov?: number
  /** Symmetric yaw half-range, in degrees. */
  yawHalfRange?: number
  minDistance?: number
  maxDistance?: number
}

function parseNumber(value: string, key: string, file: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${file}: ${key} is not a finite number`)
  return parsed
}

function parseTarget(value: string, file: string): readonly [number, number, number] {
  const parts = value.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${file}: cameraTarget wants "x, y, z"`)
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number]
}

/**
 * Reads the optional camera keys from raw frontmatter (all absent = no
 * override). Throws fail-closed on malformed values, never defaults them.
 */
export function parseCameraPreset(
  data: Record<string, string>,
  file: string,
): CameraPresetOverride {
  const override: CameraPresetOverride = {}
  if (data.cameraTarget !== undefined) override.target = parseTarget(data.cameraTarget, file)
  if (data.cameraDistance !== undefined) {
    override.distance = parseNumber(data.cameraDistance, 'cameraDistance', file)
  }
  if (data.cameraFov !== undefined) {
    const fov = parseNumber(data.cameraFov, 'cameraFov', file)
    if (fov < 5 || fov > 120) throw new Error(`${file}: cameraFov ${fov} is outside 5..120`)
    override.fov = fov
  }
  if (data.cameraYaw !== undefined) {
    const yaw = parseNumber(data.cameraYaw, 'cameraYaw', file)
    if (yaw < 0 || yaw > 90) throw new Error(`${file}: cameraYaw ${yaw} is outside 0..90`)
    override.yawHalfRange = yaw
  }
  if (data.cameraMin !== undefined) {
    override.minDistance = parseNumber(data.cameraMin, 'cameraMin', file)
  }
  if (data.cameraMax !== undefined) {
    override.maxDistance = parseNumber(data.cameraMax, 'cameraMax', file)
  }
  const { minDistance, maxDistance } = override
  if (minDistance !== undefined && maxDistance !== undefined && minDistance >= maxDistance) {
    throw new Error(`${file}: cameraMin ${minDistance} must be below cameraMax ${maxDistance}`)
  }
  return override
}

/** A preset with a frontmatter override applied (distance re-seats position). */
export function applyCameraPresetOverride(
  preset: CameraPreset,
  override: CameraPresetOverride,
): CameraPreset {
  const target = override.target ?? preset.target
  const fov = override.fov ?? preset.fov
  const yawRangeDeg =
    override.yawHalfRange === undefined
      ? preset.yawRangeDeg
      : // 0 - x (not -x): town's [0, 0] must stay [0, 0], never [-0, 0].
        ([0 - override.yawHalfRange, 0 + override.yawHalfRange] as const)
  const minDistance = override.minDistance ?? preset.minDistance
  const maxDistance = override.maxDistance ?? preset.maxDistance
  if (override.distance === undefined && override.target === undefined) {
    return { ...preset, target, fov, yawRangeDeg, minDistance, maxDistance }
  }
  const distance =
    override.distance ??
    Math.hypot(
      preset.position[0] - target[0],
      preset.position[1] - target[1],
      preset.position[2] - target[2],
    )
  const dx = preset.position[0] - preset.target[0]
  const dy = preset.position[1] - preset.target[1]
  const dz = preset.position[2] - preset.target[2]
  const len = Math.hypot(dx, dy, dz) || 1
  return {
    position: [
      target[0] + (dx / len) * distance,
      target[1] + (dy / len) * distance,
      target[2] + (dz / len) * distance,
    ],
    target,
    fov,
    yawRangeDeg,
    minDistance,
    maxDistance,
  }
}
