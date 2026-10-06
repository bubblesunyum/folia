import { z } from 'zod'
import { palette } from '../palette'

// Zod-validated frontmatter for the MDX content model (D-019). Slugs are
// unique within their parent, and top-level slugs can't collide with reserved
// words (D-004). This module is pure and three-free, so route loaders can
// import it in the SSR/prerender graph (D-047).

const paletteNames = Object.keys(palette) as [keyof typeof palette, ...(keyof typeof palette)[]]

export const townFrontmatterSchema = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
})

export const projectFrontmatterSchema = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  neon: z.enum(paletteNames),
  // Optional camera preset keys (fol-l7d.7): raw scalars only — full
  // validation lives in parseCameraPreset, the schema just stops rejecting.
  cameraTarget: z.string().optional(),
  cameraDistance: z.string().optional(),
  cameraFov: z.string().optional(),
  cameraYaw: z.string().optional(),
  cameraMin: z.string().optional(),
  cameraMax: z.string().optional(),
})

export const caseKindSchema = z.enum(['panel'])

export const caseObjectSchema = z.enum(['laptop', 'phone', 'glyph'])

export const caseFrontmatterSchema = z.strictObject({
  title: z.string().min(1),
  kind: caseKindSchema,
  summary: z.string().min(1),
  object: caseObjectSchema,
})

export type CaseKind = z.infer<typeof caseKindSchema>
export type CaseObject = z.infer<typeof caseObjectSchema>

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/** Top-level slugs that would collide with site paths (D-004). */
export const RESERVED_TOP_LEVEL_SLUGS = ['resume', 'contact', 'simple'] as const

/** A project slug becomes a top-level route, so reserved words fail closed. */
export function assertTopLevelSlug(slug: string, file: string): void {
  slugSchema.parse(slug)
  if ((RESERVED_TOP_LEVEL_SLUGS as readonly string[]).includes(slug)) {
    throw new Error(`${file}: slug "${slug}" is reserved, pick another`)
  }
}

/** Case slugs must be unique within their parent project (D-004). */
export function assertUniqueSlugs(slugs: readonly string[], parent: string): void {
  for (const slug of slugs) slugSchema.parse(slug)
  const seen = new Set<string>()
  for (const slug of slugs) {
    if (seen.has(slug)) throw new Error(`duplicate slug "${slug}" in ${parent}`)
    seen.add(slug)
  }
}
