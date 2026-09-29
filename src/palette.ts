// The single source of color for the 3D materials, the sky keyframes and the
// panel CSS (D-024). Brand colors first, then the world's.
export const palette = {
  // Structure and bold paints, from the brand.
  cream: '#F4EEE1',
  gold: '#C9A24B',
  tangerine: '#F19E4B',
  butter: '#EFEA5D',
  mint: '#4BFED2',
  lavender: '#B9A7F2',
  hotPink: '#FF4FA3',
  // Nature.
  forest: '#001E17',
  lawn: '#557C33',
  leaf: '#3F7A34',
  poolTeal: '#1C4A52',
  // Light and sky, referenced by name from time/keyframes.json.
  sunlight: '#FFD2A1',
  sunGlow: '#FFA75E',
  moonlight: '#9DB3FF',
  skyZenith: '#8397D4',
  skyDusk: '#F3C79B',
  skyNight: '#0A1424',
  skyNightHorizon: '#26325A',
} as const

export type PaletteColor = keyof typeof palette

/** Publishes the palette as `--<name>` custom properties, so CSS reads the same source. */
export function applyPaletteToCss(root: HTMLElement): void {
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--${name}`, value)
  }
}
