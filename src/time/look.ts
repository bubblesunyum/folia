// The time-of-day gradient (D-013, D-037): keyframes in keyframes.json name
// palette colors, get resolved to linear RGB once, and are interpolated by
// hour. Everything that changes with the time of day reads one `Look`.

import { type PaletteColor, type PaletteColors, palette } from '../palette'
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
  fog: {
    color: Color
    /** Exponential distance density (three's FogExp2). */
    density: number
    /**
     * Height falloff rate; larger hugs the ground. Interpolated and tested,
     * but with no consumer yet: the height half needs a composer injection
     * (D-046) that doesn't exist, so distance fog carries the look for now.
     */
    heightFalloff: number
    /** Height where the fog sits thickest. Same note as heightFalloff. */
    baseHeight: number
  }
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

/** A palette color in linear RGB, resolved through `pal` (the module palette by default). */
export function linear(name: PaletteColor, pal: PaletteColors = palette): RGB {
  const hex = pal[name]
  if (!hex) throw new Error(`keyframes name "${name}", which isn't in palette.ts`)
  const channel = (i: number) =>
    srgbToLinear(Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255)
  return [channel(0), channel(1), channel(2)]
}

function resolve(name: string, src: LookSource, pal: PaletteColors = palette): Look {
  if (!src.fog) throw new Error(`keyframes.json: keyframe "${name}" is missing "fog"`)
  const fog = src.fog
  return {
    ...src,
    sky: {
      ...src.sky,
      zenith: linear(src.sky.zenith, pal),
      horizon: linear(src.sky.horizon, pal),
      ground: linear(src.sky.ground, pal),
      glow: linear(src.sky.glow, pal),
    },
    sun: { ...src.sun, color: linear(src.sun.color, pal) },
    moon: { ...src.moon, color: linear(src.moon.color, pal) },
    fog: { ...fog, color: linear(fog.color, pal) },
    grade: {
      ...src.grade,
      shadowTint: linear(src.grade.shadowTint, pal),
      highlightTint: linear(src.grade.highlightTint, pal),
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

/** Keyframes from their JSON, sorted by hour, colors resolved through `pal`. */
export function loadKeyframes(
  json: { keyframes: readonly unknown[] },
  pal: PaletteColors = palette,
): Keyframe[] {
  return (
    json.keyframes as {
      name: string
      hours: number
      provisional?: boolean
      look: LookSource
    }[]
  )
    .map((k) => ({ ...k, look: resolve(k.name, k.look, pal) }))
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

/** One keyframe as the look-dev panel edits it: structure fixed, values live. */
export interface DraftKeyframe {
  name: string
  hours: number
  provisional?: boolean
  look: LookSource
}

/** The panel's working copy: palette values plus keyframe sources, by name. */
export interface LookDraft {
  palette: Record<PaletteColor, string>
  keyframes: DraftKeyframe[]
}

/** The working copy the panel starts from: the files as they are on disk. */
export function initialDraft(): LookDraft {
  return {
    palette: { ...palette },
    keyframes: structuredClone(source.keyframes) as unknown as DraftKeyframe[],
  }
}

/** The look at `hours` under a working copy, colors resolved through its palette. */
export function resolveDraft(draft: LookDraft, hours: number): Look {
  return lookAt(hours, loadKeyframes({ keyframes: draft.keyframes }, draft.palette))
}
