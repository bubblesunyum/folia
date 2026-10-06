// Yaw limits per place (D-008): fixed at town, a limited orbit that springs
// back at a neighborhood. Pure tuple math so Vitest pins it without three;
// the rig only wires events and the camera. Angles in radians; ranges come
// from the place preset (cameraPresets), so content stays the source.

export type Vec3 = readonly [number, number, number]

/** Azimuth of an orbit offset (camera minus target), in radians. */
export function azimuthOf(offset: Vec3): number {
  return Math.atan2(offset[0], offset[2])
}

/** Clamp an azimuth into [min, max] radians. */
export function clampAzimuth(azimuth: number, min: number, max: number): number {
  return Math.min(Math.max(azimuth, min), max)
}

/**
 * The allowed azimuth window for a preset: its base azimuth plus the
 * symmetric half-range, in radians. Town's range is [0, 0], so the window is
 * a point and any orbit springs back.
 */
export function yawWindow(
  baseAzimuthDeg: number,
  halfRangeDeg: number,
): {
  min: number
  max: number
} {
  const base = (baseAzimuthDeg * Math.PI) / 180
  const half = (Math.abs(halfRangeDeg) * Math.PI) / 180
  return { min: base - half, max: base + half }
}

/**
 * Where an azimuth sits against its window: the clamped value, and whether
 * it is out past `snapRad` (settled steps don't restart the spring).
 */
export function yawClampStatus(
  azimuth: number,
  window: { min: number; max: number },
  snapRad: number,
): { clamped: number; outOfRange: boolean } {
  const clamped = clampAzimuth(azimuth, window.min, window.max)
  return { clamped, outOfRange: Math.abs(clamped - azimuth) > snapRad }
}

/** Rotate an orbit offset around Y by `deltaAz` radians. */
export function rotateOffsetY(offset: Vec3, deltaAz: number): Vec3 {
  const cos = Math.cos(deltaAz)
  const sin = Math.sin(deltaAz)
  return [offset[0] * cos + offset[2] * sin, offset[1], -offset[0] * sin + offset[2] * cos]
}

/**
 * Wheel-pan scale: world metres per CSS pixel, matching OrbitControls' own
 * `_pan` perspective branch (`2 * delta * distance * tan(fov / 2) /
 * clientHeight`), so a two-finger swipe pans exactly like a drag-pan would.
 */
export function wheelPanScale(distance: number, viewportHeightPx: number, fovDeg: number): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(viewportHeightPx) ||
    viewportHeightPx <= 0 ||
    !(fovDeg > 0) ||
    !(fovDeg < 180)
  ) {
    return 0
  }
  return (2 * Math.max(distance, 0) * Math.tan(((fovDeg / 2) * Math.PI) / 180)) / viewportHeightPx
}

/** Settle snap for the yaw spring: sub-pixel at town distance. */
export const YAW_SNAP_RAD = 0.0005
