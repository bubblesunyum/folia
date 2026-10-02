import { useParams } from 'react-router'
import { hoodFromProject } from './palette'

/**
 * The one route-project → signature-hood wiring (fol-5co): Cortico on the
 * town root, the route project everywhere else. Scene and panel both read
 * through here instead of each repeating `useParams` + `hoodFromProject`,
 * so panel never imports from scene (or vice versa) for it.
 */
export function useHood(): string {
  const { project } = useParams()
  return hoodFromProject(project)
}
