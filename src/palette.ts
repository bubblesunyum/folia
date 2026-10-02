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

/** Palette values by name; accepts the module palette and editable drafts. */
export type PaletteColors = { readonly [K in PaletteColor]: string }

/**
 * One signature glow color per neighborhood (D-024): Cortico reads mint.
 * Slugs follow the `:project` route: the eight spec-named hoods plus Cortico.
 * Only Cortico is built, so only its entry renders today; the rest fail
 * closed through `signatureColor` until their geometry lands.
 */
export const neighborhoodSignature = {
  cortico: 'mint',
  'early-work': 'butter',
  'blackjack-genius': 'gold',
  glyphite: 'lavender',
  'purple-republic': 'hotPink',
  'express-your-mess': 'tangerine',
  'express-your-yes': 'sunGlow',
  'iron-ox': 'moonlight',
} as const satisfies Record<string, PaletteColor>

/** The route project is the signature hood (fol-5co): the town root has no
 * `:project`, so it reads Cortico. Pure and three-free, so anything in the
 * SSR graph can map routes to hoods. Unknown projects pass through and fail
 * closed inside `signatureColor` — or 404 earlier at the route loader. */
export function hoodFromProject(project: string | undefined): string {
  return project ?? 'cortico'
}

/** The palette hex behind a neighborhood's signature glow; throws on an unmapped hood. */
export function signatureColor(hood: string, pal: PaletteColors = palette): string {
  const key = (neighborhoodSignature as Readonly<Record<string, PaletteColor>>)[hood]
  if (key === undefined) throw new Error(`no signature color for hood "${hood}"`)
  return pal[key]
}

/** Publishes the palette as `--<name>` custom properties, so CSS reads the same source. */
export function applyPaletteToCss(root: HTMLElement, pal: PaletteColors = palette): void {
  for (const [name, value] of Object.entries(pal)) {
    root.style.setProperty(`--${name}`, value)
  }
}
