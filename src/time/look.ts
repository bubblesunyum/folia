// The time-of-day gradient (D-013, D-037): keyframes in keyframes.json name
// palette colors, get resolved to linear RGB once, and are interpolated by
// hour. Everything that changes with the time of day reads one `Look`.

import { type PaletteColor, palette } from '../palette'
import source from './keyframes.json'

export type RGB = readonly [number, number, number]

interface LookShape<Color> {
  sky: {
    zenith: Color
    horizon: Color
    /** The env scene's dark-green ground hemisphere (D-040). */
    ground: Color
    glow: Color
    glowIntensity: number
    glowSharpness: number
    clouds: number
  }
  sun: { color: Color; intensity: number }
  moon: { color: Color; intensity: number }
  env: { intensity: number }
  /** Weight of the baked `_NIGHT` spill (D-031). */
  night: number
  /** Neon emissive multiplier (D-038). */
  emissive: number
  bloom: { intensity: number; threshold: number; smoothing: number }
  grade: {
    lift: RGB
    gamma: RGB
    gain: RGB
    saturation: number
    shadowTint: Color
    highlightTint: Color
    split: number
  }
}

export type Look = LookShape<RGB>
export type LookSource = LookShape<PaletteColor>

export interface Keyframe {
  name: string
  hours: number
  /** Not art-directed yet; interpolation stand-in (D-037). */
  provisional?: boolean
  look: Look
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A palette color in linear RGB. */
export function linear(name: PaletteColor): RGB {
  const hex = palette[name]
  if (!hex) throw new Error(`keyframes name "${name}", which isn't in palette.ts`)
  const channel = (i: number) =>
    srgbToLinear(Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255)
  return [channel(0), channel(1), channel(2)]
}

function resolve(src: LookSource): Look {
  return {
    ...src,
    sky: {
      ...src.sky,
      zenith: linear(src.sky.zenith),
      horizon: linear(src.sky.horizon),
      ground: linear(src.sky.ground),
      glow: linear(src.sky.glow),
    },
    sun: { ...src.sun, color: linear(src.sun.color) },
    moon: { ...src.moon, color: linear(src.moon.color) },
    grade: {
      ...src.grade,
      shadowTint: linear(src.grade.shadowTint),
      highlightTint: linear(src.grade.highlightTint),
    },
  }
}

function lerpTree<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * t) as T
  if (Array.isArray(a)) return a.map((v, i) => lerpTree(v, (b as unknown[])[i], t)) as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(a as object)) {
    out[key] = lerpTree((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], t)
  }
  return out as T
}

export function lerpLook(a: Look, b: Look, t: number): Look {
  return lerpTree(a, b, t)
}

/** Keyframes from their JSON, sorted by hour, colors resolved. */
export function loadKeyframes(json: { keyframes: readonly unknown[] }): Keyframe[] {
  return (
    json.keyframes as { name: string; hours: number; provisional?: boolean; look: LookSource }[]
  )
    .map((k) => ({ ...k, look: resolve(k.look) }))
    .sort((a, b) => a.hours - b.hours)
}

export const KEYFRAMES = loadKeyframes(source)

/** The look at `hours`, eased between the keyframes either side, wrapping at midnight. */
export function lookAt(hours: number, keyframes: readonly Keyframe[] = KEYFRAMES): Look {
  const h = ((hours % 24) + 24) % 24
  const nextIndex = keyframes.findIndex((k) => k.hours > h)
  const next = keyframes[nextIndex === -1 ? 0 : nextIndex]
  const prev = keyframes[nextIndex <= 0 ? keyframes.length - 1 : nextIndex - 1]
  if (!prev || !next) throw new Error('lookAt needs at least one keyframe')
  const span = (next.hours - prev.hours + 24) % 24 || 24
  const t = ((h - prev.hours + 24) % 24) / span
  return lerpLook(prev.look, next.look, t * t * (3 - 2 * t))
}
