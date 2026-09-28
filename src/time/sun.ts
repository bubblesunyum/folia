// A placeholder sun arc, so the scrubber has something to drive until the
// time-of-day gradient replaces it in phase 1 (D-013, D-037).

const SUNRISE = 6
const SUNSET = 20
const MAX_ELEVATION = (65 * Math.PI) / 180

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
  const azimuth = Math.PI * (t - 0.5)
  const flat = Math.cos(elevation)
  return {
    direction: [flat * Math.sin(azimuth), Math.sin(elevation), flat * Math.cos(azimuth)],
    elevation,
    daylight: Math.min(Math.max(Math.sin(elevation) * 4, 0), 1),
  }
}
