// The single source of color for the 3D materials and the panel CSS (D-024).
// Entries marked provisional are stand-ins until the spike 1 look-dev sets them.
export const palette = {
  cream: '#F4EEE1', // provisional
  gold: '#C9A24B', // provisional
  tangerine: '#F19E4B',
  butter: '#EFEA5D',
  mint: '#4BFED2',
  lavender: '#B9A7F2', // provisional
  hotPink: '#FF4FA3', // provisional
  forest: '#001E17',
  skyDusk: '#F3C79B', // provisional
  skyNight: '#0A1424', // provisional
} as const

export type PaletteColor = keyof typeof palette

/** Publishes the palette as `--<name>` custom properties, so CSS reads the same source. */
export function applyPaletteToCss(root: HTMLElement): void {
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--${name}`, value)
  }
}
