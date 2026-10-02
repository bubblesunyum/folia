// The camera reframe for the open panel (fol-l1r.5, D-022/D-050): the orbit
// target eases toward the open pedestal (back to town when it closes), the
// camera dollies to the panel vantage on wide screens (fol-bsw), and the
// camera takes a view offset so the scene sits centered in the uncovered
// area — right of nothing on wide screens (the sheet takes the right),
// above the bottom sheet on narrow ones. The offset animates with the panel
// and re-applies on every resize; reduced motion jumps straight there.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { beginCameraFlight, currentCameraFlight } from '../input/cameraFlight'
import { readReducedMotion } from '../input/intent'
import { damp, expFactor } from '../motion/damp'
import { setOrbitDistance } from '../motion/orbit'
import { setCanvasHook } from '../testHooks'
import { resolvePanelDolly } from './panelDolly'
import { type PedestalSlug, requireAnchor, TOWN_ORBIT_TARGET } from './pedestals'
import { usePanelLayout } from './usePanelLayout'

const FOCUS_RATE = 3
const OFFSET_RATE = 6
const FOCUS_SNAP_M = 0.02
const OFFSET_SNAP_PX = 0.5
const DOLLY_RATE = 3
const DOLLY_SNAP_M = 0.1

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

const scratchFocus = new THREE.Vector3()

export function PanelCameraRig() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const layout = usePanelLayout()
  const rig = useRef({
    slug: null as PedestalSlug | null,
    focusArrived: true,
    viewX: 0,
    viewY: 0,
    targetX: 0,
    targetY: 0,
    writtenOffset: '',
    writtenFocus: '',
    // Panel vantage dolly (fol-bsw): the goal distance, the pre-open
    // distance to restore on close, and our flight generation. Another
    // driver (user zoom) bumps the generation and we yield.
    dollyGoal: null as number | null,
    dollyRestore: null as number | null,
    dollyFlight: 0,
  })
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  const { x: viewTargetX, y: viewTargetY } = layout.viewTarget
  const layoutVariant = layout.variant
  useEffect(() => {
    const canvas = gl.domElement
    const slug = layout.slug
    rig.current.slug = slug
    rig.current.targetX = viewTargetX
    rig.current.targetY = viewTargetY
    rig.current.focusArrived = slug === null && rig.current.viewX === 0 && rig.current.viewY === 0
    // The open case reports at once; focus follows once the ease lands.
    setCanvasHook(canvas, 'panel', slug ?? '')
    // Panel vantage dolly (fol-bsw): the pure step decides, the effect only
    // applies. See panelDolly.ts for the session semantics.
    const target = controlsRef.current?.target
    const decision = resolvePanelDolly({
      slug,
      variant: layoutVariant,
      distance: target ? camera.position.distanceTo(target) : null,
      state: { goal: rig.current.dollyGoal, restore: rig.current.dollyRestore },
    })
    rig.current.dollyGoal = decision.state.goal
    rig.current.dollyRestore = decision.state.restore
    if (decision.claim) rig.current.dollyFlight = beginCameraFlight()
    // A new target always needs frames until the ease lands; a resize
    // re-targets while the demand loop may be at rest.
    invalidate()
  }, [gl, invalidate, camera, layout.slug, layoutVariant, viewTargetX, viewTargetY])

  useEffect(() => {
    const canvas = gl.domElement
    // Hooks exist from mount (empty, not absent) so specs can wait on them.
    // The open case itself is reported by the layout effect above.
    rig.current.writtenOffset = ''
    rig.current.writtenFocus = ''
    setCanvasHook(canvas, 'viewOffset', '')
    setCanvasHook(canvas, 'focus', '')
  }, [gl])

  useFrame((_, rawDt) => {
    const r = rig.current
    const dt = Math.min(Math.max(rawDt, 1 / 240), 0.05)
    const reduced = readReducedMotion()
    let busy = false

    // Orbit-target ease toward the open pedestal, home when it closes.
    const anchor = r.slug === null ? TOWN_ORBIT_TARGET : requireAnchor(r.slug)
    scratchFocus.set(anchor[0], anchor[1], anchor[2])
    const target = controlsRef.current?.target
    if (target) {
      if (reduced) {
        if (!target.equals(scratchFocus)) {
          target.copy(scratchFocus)
          controlsRef.current?.update()
        }
      } else if (target.distanceTo(scratchFocus) > FOCUS_SNAP_M) {
        target.lerp(scratchFocus, expFactor(FOCUS_RATE, dt))
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

    // Panel vantage dolly (fol-bsw): ease the orbit distance toward the goal
    // alongside the focus ease. Another driver bumps the flight generation
    // (user zoom claims it on every step) and we yield, clearing the session
    // restore with it. Arrival clears the goal; arriving back at the restore
    // ends the session.
    if (r.dollyGoal !== null && target) {
      if (currentCameraFlight() !== r.dollyFlight) {
        r.dollyGoal = null
        r.dollyRestore = null
      } else {
        const goal = r.dollyGoal
        const distance = camera.position.distanceTo(target)
        const step = reduced ? goal : damp(distance, goal, DOLLY_RATE, dt, DOLLY_SNAP_M)
        if (step !== distance) {
          setOrbitDistance(camera, target, step, controlsRef.current)
          busy = true
        }
        if (step === goal) {
          if (goal === r.dollyRestore) r.dollyRestore = null
          r.dollyGoal = null
        }
      }
    }

    // View-offset ease with the panel; re-applied live on resize above.
    const easeOffset = (current: number, goal: number): number => {
      if (reduced) return goal
      if (current !== goal) busy = true
      return damp(current, goal, OFFSET_RATE, dt, OFFSET_SNAP_PX)
    }
    r.viewX = easeOffset(r.viewX, r.targetX)
    r.viewY = easeOffset(r.viewY, r.targetY)
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
