// The camera reframe for the open panel (fol-l1r.5, D-022/D-050): the orbit
// target eases toward the open pedestal (back to town when it closes), and
// the camera takes a view offset so the scene sits centered in the uncovered
// area — right of nothing on wide screens (the sheet takes the right),
// above the bottom sheet on narrow ones. The offset animates with the panel
// and re-applies on every resize; reduced motion jumps straight there.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { readReducedMotion } from '../input/intent'
import { setCanvasHook } from '../testHooks'
import { getCaseInView, onCaseInView } from './caseInView'
import { PEDESTAL_ANCHOR_BY_SLUG, type PedestalSlug, TOWN_ORBIT_TARGET } from './pedestals'

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

/** Below this width the sheet docks to the bottom instead of the right. */
export const PANEL_NARROW_PX = 900

/** The sheet's share of a wide viewport, capped for readable measure. */
export const PANEL_WIDE_FRACTION = 0.45
export const PANEL_WIDE_MAX_PX = 640

/** The bottom sheet's share of a narrow viewport, capped so world remains. */
export const PANEL_SHEET_FRACTION = 0.5
export const PANEL_SHEET_MAX_PX = 420

const FOCUS_RATE = 3
const OFFSET_RATE = 6
const FOCUS_SNAP_M = 0.02
const OFFSET_SNAP_PX = 0.5

const scratchFocus = new THREE.Vector3()

/** The view-offset target for a viewport with (or without) an open panel. */
export function viewOffsetTarget(
  viewportWidth: number,
  viewportHeight: number,
  panelSlug: PedestalSlug | null,
): { x: number; y: number } {
  if (panelSlug === null) return { x: 0, y: 0 }
  if (viewportWidth >= PANEL_NARROW_PX) {
    return { x: Math.min(viewportWidth * PANEL_WIDE_FRACTION, PANEL_WIDE_MAX_PX) / 2, y: 0 }
  }
  return { x: 0, y: Math.min(viewportHeight * PANEL_SHEET_FRACTION, PANEL_SHEET_MAX_PX) / 2 }
}

export function PanelCameraRig() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const rig = useRef({
    slug: null as PedestalSlug | null,
    focusArrived: true,
    viewX: 0,
    viewY: 0,
    targetX: 0,
    targetY: 0,
    writtenOffset: '',
    writtenFocus: '',
  })
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  useEffect(() => {
    const canvas = gl.domElement
    const writeFocus = (text: string): void => {
      if (text === rig.current.writtenFocus) return
      rig.current.writtenFocus = text
      setCanvasHook(canvas, 'focus', text)
    }
    const recomputeView = (): void => {
      const target = viewOffsetTarget(window.innerWidth, window.innerHeight, rig.current.slug)
      rig.current.targetX = target.x
      rig.current.targetY = target.y
    }
    const sync = (slug: PedestalSlug | null): void => {
      rig.current.slug = slug
      rig.current.focusArrived = slug === null && rig.current.viewX === 0 && rig.current.viewY === 0
      // The open case reports at once; focus follows once the ease lands.
      setCanvasHook(canvas, 'panel', slug ?? '')
      writeFocus('')
      recomputeView()
      invalidate()
    }
    const off = onCaseInView(sync)
    // The presenter may have opened before the canvas chunk loaded.
    sync(getCaseInView())
    // Hooks exist from mount (empty, not absent) so specs can wait on them.
    rig.current.writtenOffset = ''
    rig.current.writtenFocus = ''
    setCanvasHook(canvas, 'viewOffset', '')
    setCanvasHook(canvas, 'focus', '')
    const onResize = (): void => {
      recomputeView()
      invalidate()
    }
    window.addEventListener('resize', onResize)
    return () => {
      off()
      window.removeEventListener('resize', onResize)
    }
  }, [gl, invalidate])

  useFrame((_, rawDt) => {
    const r = rig.current
    const dt = Math.min(Math.max(rawDt, 1 / 240), 0.05)
    const reduced = readReducedMotion()
    let busy = false

    // Orbit-target ease toward the open pedestal, home when it closes.
    const anchor = r.slug === null ? TOWN_ORBIT_TARGET : PEDESTAL_ANCHOR_BY_SLUG[r.slug]
    scratchFocus.set(anchor[0], anchor[1], anchor[2])
    const target = controlsRef.current?.target
    if (target) {
      if (reduced) {
        if (!target.equals(scratchFocus)) {
          target.copy(scratchFocus)
          controlsRef.current?.update()
        }
      } else if (target.distanceTo(scratchFocus) > FOCUS_SNAP_M) {
        const t = 1 - Math.exp(-FOCUS_RATE * dt)
        target.lerp(scratchFocus, t)
        if (target.distanceTo(scratchFocus) <= FOCUS_SNAP_M) target.copy(scratchFocus)
        controlsRef.current?.update()
        busy = true
      }
    }
    const focusText =
      r.slug !== null && target && target.distanceTo(scratchFocus) <= FOCUS_SNAP_M ? r.slug : ''
    const canvas = gl.domElement
    if (focusText !== r.writtenFocus) {
      r.writtenFocus = focusText
      setCanvasHook(canvas, 'focus', focusText)
    }
    r.focusArrived = focusText !== '' || r.slug === null

    // View-offset ease with the panel; re-applied live on resize above.
    const damp = (current: number, goal: number): number => {
      if (reduced) return goal
      if (Math.abs(goal - current) <= OFFSET_SNAP_PX) return goal
      busy = true
      return current + (goal - current) * (1 - Math.exp(-OFFSET_RATE * dt))
    }
    r.viewX = damp(r.viewX, r.targetX)
    r.viewY = damp(r.viewY, r.targetY)
    const persp = camera as THREE.PerspectiveCamera
    if (r.viewX === 0 && r.viewY === 0) {
      if (persp.view?.enabled === true) persp.clearViewOffset()
    } else {
      persp.setViewOffset(
        window.innerWidth,
        window.innerHeight,
        r.viewX,
        r.viewY,
        window.innerWidth,
        window.innerHeight,
      )
    }
    const offsetText =
      r.viewX === 0 && r.viewY === 0 ? '' : `${Math.round(r.viewX)},${Math.round(r.viewY)}`
    if (offsetText !== r.writtenOffset) {
      r.writtenOffset = offsetText
      setCanvasHook(canvas, 'viewOffset', offsetText)
    }
    if (r.viewX !== r.targetX || r.viewY !== r.targetY) busy = true

    if (busy) invalidate()
  })

  return null
}
