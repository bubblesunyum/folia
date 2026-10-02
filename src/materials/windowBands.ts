// Warm window bands at night (fol-snu.3): an emissive window-band term on
// facades, materials-side, so night reads navy plus warm instead of one navy
// tone. No modeled windows or lanterns exist in the fragment, so the bands are
// the mechanism: horizontal lit slits at a floor spacing, broken into separate
// windows by a per-cell hash that leaves some dark. Composed on cream and gold
// (facades) only — never ground or foliage. Gated by the night weight, so
// daylight is exactly unchanged (shader-inert defaults: weight 0, color black).

import { Color } from 'three'
import type { Feature } from './composer'

/** Floor-to-floor spacing of the window rows, in metres. */
export const WINDOW_SPACING_M = 2.4
/** Fraction of each floor row that glows (the slit height). */
export const WINDOW_BAND_F = 0.32
/** Horizontal window cell width, in metres (x+z keeps curved terraces varied). */
export const WINDOW_CELL_M = 1.8
/** Hash threshold at or above which a window reads lit. */
export const WINDOW_LIT_AT = 0.38

const smooth01 = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Fractional position of `y` within its floor row, mirroring the shader. */
export function windowRowF(y: number): number {
  const row = y / WINDOW_SPACING_M
  return row - Math.floor(row)
}

/** The slit mask at height `y`: 1 inside the band, 0 outside, soft edges. */
export function windowBand(y: number): number {
  const f = windowRowF(y)
  return smooth01(0, 0.08, f) * (1 - smooth01(WINDOW_BAND_F - 0.08, WINDOW_BAND_F, f))
}

/** The cell hash for window `(cellU, row)`, mirroring the shader's fract-sin. */
export function windowHash(cellU: number, row: number): number {
  const s = Math.sin(cellU * 12.9898 + row * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** Whether window `(cellU, row)` reads lit; the rest stay dark. */
export function windowLit(cellU: number, row: number): boolean {
  return windowHash(cellU, row) >= WINDOW_LIT_AT
}

/** Per-window brightness jitter, 0.55–1.0, for the lit windows. Mirrors the
 * shader's `windowHash(windowCell * 1.37 + 11.3)` exactly (scalar adds to
 * both components), so vitest pins the shipped brightness, not a cousin. */
export function windowBrightness(cellU: number, row: number): number {
  const h = windowHash(cellU * 1.37 + 11.3, row * 1.37 + 11.3)
  return 0.55 + 0.45 * h
}

export const windowBands = {
  key: 'window-bands',
  uniforms: {
    // Night weight (fol-snu.3): driven by the look's night weight, so the
    // term is exactly zero by day. Zero until `applyLook` claims it: the
    // feature composes unconditionally, so a nonzero default would tint still
    // renders with the look unapplied.
    uWindowNight: { value: 0 },
    // Warm window color (fol-snu.3): palette sunGlow, written by `applyLook`.
    // Black until claimed, for the same reason.
    uWindowColor: { value: new Color(0, 0, 0) },
  },
  vertex: {
    // World-baked batches carry world position in local position (see the
    // reveal feature), so the bands need no batch/instance path here.
    header: 'varying vec3 vWindowWorld;',
    chunks: {
      begin_vertex: { after: 'vWindowWorld = position;' },
    },
  },
  fragment: {
    header: /* glsl */ `
      uniform float uWindowNight;
      uniform vec3 uWindowColor;
      varying vec3 vWindowWorld;
      float windowHash(vec2 cell) {
        return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      }`,
    chunks: {
      emissivemap_fragment: {
        after: /* glsl */ `
          // Warm windows (fol-snu.3): near-vertical facade surfaces only, so
          // terrace floors stay dark. normal is view space here; the inverse
          // view rotation recovers the world up component.
          vec3 windowWorldN = inverseTransformDirection(normal, viewMatrix);
          float windowVertical = smoothstep(0.35, 0.65, 1.0 - abs(windowWorldN.y));
          float windowRow = vWindowWorld.y / ${WINDOW_SPACING_M.toFixed(2)};
          float windowRowF = fract(windowRow);
          float windowSlit = smoothstep(0.0, 0.08, windowRowF)
            * (1.0 - smoothstep(${(WINDOW_BAND_F - 0.08).toFixed(2)}, ${WINDOW_BAND_F.toFixed(2)}, windowRowF));
          vec2 windowCell = vec2(floor((vWindowWorld.x + vWindowWorld.z) / ${WINDOW_CELL_M.toFixed(2)}), floor(windowRow));
          float windowH = windowHash(windowCell);
          float windowOn = step(${WINDOW_LIT_AT.toFixed(2)}, windowH);
          float windowBright = 0.55 + 0.45 * windowHash(windowCell * 1.37 + 11.3);
          // Weighted by the night weight, so daylight is exactly unchanged.
          totalEmissiveRadiance += uWindowColor
            * (windowSlit * windowVertical * windowOn * windowBright * uWindowNight);`,
      },
    },
  },
} satisfies Feature
