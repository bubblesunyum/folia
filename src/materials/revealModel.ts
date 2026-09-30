// The reveal's CPU mirror (D-018, D-044): the cream band is a color and
// roughness blend above `revealHeight`, never a `discard`. Parked below the
// town the mix is exactly zero, so still renders sit on the authored look;
// the reveal driver raises it with the ocean and re-parks when done.

/** Parked height in metres: below everything, so the band mix is zero. */
export const REVEAL_PARKED_M = -100000
/** The glossy cream band's width in metres. */
export const REVEAL_BAND_M = 0.5
/** Roughness inside the band: wet cream flowing off. */
export const REVEAL_GLOSS = 0.15

/** GLSL smoothstep mirror (see swayModel.ts): the Hermite ease, clamped outside. */
export function revealStep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** The cream mix at world height `y`: full at/below the line, fading up through the band. */
export function revealMix(y: number, height: number, band: number): number {
  return 1 - revealStep(height, height + band, y)
}
