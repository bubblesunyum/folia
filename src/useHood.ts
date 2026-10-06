import { useParams } from 'react-router'
import { hoodFromProject } from './palette'

/** The route project, read in exactly one place: both hooks below derive from here. */
function useRouteProject(): string | undefined {
  const { project } = useParams()
  return project
}

/**
 * The one route-project → signature-hood wiring (fol-5co): Cortico on the
 * town root, the route project everywhere else. Scene and panel both read
 * through here instead of each repeating `useParams` + `hoodFromProject`,
 * so panel never imports from scene (or vice versa) for it.
 */
export function useHood(): string {
  return hoodFromProject(useRouteProject())
}

/**
 * The vantage hood, if the route is a neighborhood vantage or below it:
 * `/cortico` and `/cortico/<case>` return `cortico`, `/` returns null.
 * `BlenderAsset` streams a hood's high LOD only here (fol-l7d.2) — at `/`
 * the town loads mid only. The rule itself is `shouldStreamHigh`, pinned in
 * vitest instead of pixels.
 */
export function useVantageHood(): string | null {
  return useRouteProject() ?? null
}
