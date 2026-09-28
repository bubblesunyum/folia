// The sun's position by hour: a simple arc from sunrise to sunset, turned to
// suit the town's fixed yaw. The look keyframes (look.ts) set its colour and
// strength; the moon reuses the arc twelve hours on.

const SUNRISE = 6
const SUNSET = 20
const MAX_ELEVATION = (65 * Math.PI) / 180
// Turns the arc so that at golden hour the sun sits behind and to the right of
// the fixed town yaw: rim light on foliage and gold, shadows falling toward
// the viewer, rather than flat front light.
const AZIMUTH_OFFSET = (95 * Math.PI) / 180

export interface Sun {
  /** Unit vector pointing at the sun. */
  direction: [number, number, number]
  /** Radians above the horizon; negative at night. */
  elevation: number
  /** 0 at night, rising to 1 once the sun is ~15° up. */
  daylight: number
}

export function sunAt(hours: number): Sun {
  const t = (hours - SUNRISE) / (SUNSET - SUNRISE)
  const elevation = Math.sin(Math.PI * t) * MAX_ELEVATION
  const azimuth = Math.PI * (t - 0.5) + AZIMUTH_OFFSET
  const flat = Math.cos(elevation)
  return {
    direction: [flat * Math.sin(azimuth), Math.sin(elevation), flat * Math.cos(azimuth)],
    elevation,
    daylight: Math.min(Math.max(Math.sin(elevation) * 4, 0), 1),
  }
}
