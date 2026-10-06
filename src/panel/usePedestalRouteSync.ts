import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { CASE_OPEN_EVENT, type CaseOpenDetail } from './pedestalEvents'
import { resolveCaseNav } from './pedestals'

/**
 * Canvas clicks navigate through here (fol-l1r.5): the canvas rig owns the
 * raycast but can't see router context, so it dispatches CASE_OPEN_EVENT and
 * this DOM hook — mounted everywhere pedestals are clickable (`/cortico`
 * and the PanelPresenter) — resolves push vs replace (D-021) and navigates.
 */
export function usePedestalRouteSync(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  const searchRef = useRef(location.search)
  searchRef.current = location.search
  const projectRef = useRef(params.project)
  projectRef.current = params.project
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  useEffect(() => {
    const onOpen = (event: Event) => {
      const slug = (event as CustomEvent<CaseOpenDetail>).detail?.slug
      if (slug === undefined || slug === null) return
      const nav = resolveCaseNav(pathRef.current, slug, projectRef.current, searchRef.current)
      navigateRef.current(nav.to, { replace: nav.replace })
    }
    window.addEventListener(CASE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CASE_OPEN_EVENT, onOpen)
  }, [])
}
