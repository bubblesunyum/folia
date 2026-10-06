// The camera reframe for the open panel (fol-l1r.5, D-022/D-050): the orbit
// target flies toward the open pedestal (back to town when it closes), the
// camera dollies to the panel vantage on wide screens (fol-bsw), and the
// camera takes a view offset so the scene sits centered in the uncovered
// area — right of nothing on wide screens (the sheet takes the right),
// above the bottom sheet on narrow ones. The offset flies with the panel
// and re-applies on every resize; reduced motion jumps straight there.
//
// Every channel flies on the one camera easing (motion/flight) all rises and
// flights share: fixed-duration tweens engaged from the live value when
// their goal moves. The contract PanelPresenter and the specs rely on is
// unchanged: the `panel`/`focus`/`viewOffset` canvas hooks, the
// flight-generation yield to user zoom, the dolly session semantics in
// panelDolly, and the rest guard (no invalidate once every channel lands).

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { beginCameraFlight, currentCameraFlight } from '../input/cameraFlight'
import { readReducedMotion } from '../input/intent'
import { flightAt, flightVec3, OFFSET_MS, REFRAME_MS, tweenProgress } from '../motion/flight'
import { setOrbitDistance } from '../motion/orbit'
import { setCanvasHook } from '../testHooks'
import { dollyFlightStep, resolvePanelDolly } from './panelDolly'
import { type PedestalSlug, requireAnchor, TOWN_ORBIT_TARGET } from './pedestals'
import { usePanelLayout } from './usePanelLayout'

const FOCUS_SNAP_M = 0.02
const OFFSET_SNAP_PX = 0.5
const DOLLY_SNAP_M = 0.1

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

interface ScalarTween {
  from: number
  to: number
  start: number
}

interface FocusTween {
  fromVec: THREE.Vector3
  toVec: THREE.Vector3
  start: number
}

interface OffsetTween {
  fromX: number
  toX: number
  fromY: number
  toY: number
  start: number
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
    // One-easing flights, engaged from the live value when a goal moves.
    focusTween: null as FocusTween | null,
    dollyTween: null as ScalarTween | null,
    offsetTween: null as OffsetTween | null,
  })
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  const { x: viewTargetX, y: viewTargetY } = layout.viewTarget
  const layoutVariant = layout.variant
  useEffect(() => {
    const canvas = gl.domElement
    const slug = layout.slug
    const r = rig.current
    const focusMoved = r.slug !== slug
    r.slug = slug
    r.targetX = viewTargetX
    r.targetY = viewTargetY
    // The open case reports at once; focus follows once the flight lands.
    setCanvasHook(canvas, 'panel', slug ?? '')
    const target = controlsRef.current?.target
    // Focus flight: from the live orbit target toward the new anchor.
    if (focusMoved && target) {
      const anchor = slug === null ? TOWN_ORBIT_TARGET : requireAnchor(slug)
      r.focusTween = {
        fromVec: target.clone(),
        toVec: new THREE.Vector3(anchor[0], anchor[1], anchor[2]),
        start: performance.now(),
      }
    }
    // Offset flight: from the live offset toward the new target.
    if (r.viewX !== viewTargetX || r.viewY !== viewTargetY) {
      r.offsetTween = {
        fromX: r.viewX,
        toX: viewTargetX,
        fromY: r.viewY,
        toY: viewTargetY,
        start: performance.now(),
      }
    } else {
      r.offsetTween = null
    }
    // Panel vantage dolly (fol-bsw): the pure step decides, the effect only
    // applies. See panelDolly.ts for the session semantics.
    const decision = resolvePanelDolly({
      slug,
      variant: layoutVariant,
      distance: target ? camera.position.distanceTo(target) : null,
      state: { goal: r.dollyGoal, restore: r.dollyRestore },
    })
    const goalMoved = decision.state.goal !== r.dollyGoal
    r.dollyGoal = decision.state.goal
    r.dollyRestore = decision.state.restore
    if (decision.claim) r.dollyFlight = beginCameraFlight()
    if (goalMoved && r.dollyGoal !== null && target) {
      r.dollyTween = {
        from: camera.position.distanceTo(target),
        to: r.dollyGoal,
        start: performance.now(),
      }
    } else if (r.dollyGoal === null) {
      r.dollyTween = null
    }
    // A new target always needs frames until the flight lands; a resize
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

  useFrame(() => {
    const r = rig.current
    const now = performance.now()
    const reduced = readReducedMotion()
    let busy = false

    // Orbit-target flight toward the open pedestal, home when it closes.
    const anchor = r.slug === null ? TOWN_ORBIT_TARGET : requireAnchor(r.slug)
    scratchFocus.set(anchor[0], anchor[1], anchor[2])
    const target = controlsRef.current?.target
    if (target) {
      if (reduced) {
        r.focusTween = null
        if (!target.equals(scratchFocus)) {
          target.copy(scratchFocus)
          controlsRef.current?.update()
        }
      } else if (r.focusTween) {
        const tween = r.focusTween
        const progress = tweenProgress(tween.start, now, REFRAME_MS)
        flightVec3(target, tween.fromVec, tween.toVec, progress)
        controlsRef.current?.update()
        if (progress >= 1 || target.distanceTo(scratchFocus) <= FOCUS_SNAP_M) {
          target.copy(scratchFocus)
          controlsRef.current?.update()
          r.focusTween = null
        } else {
          busy = true
        }
      } else if (target.distanceTo(scratchFocus) > FOCUS_SNAP_M) {
        // The target moved under us (a user pan): follow on the one easing.
        r.focusTween = {
          fromVec: target.clone(),
          toVec: scratchFocus.clone(),
          start: now,
        }
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

    // Panel vantage dolly (fol-bsw): fly the orbit distance toward the goal
    // alongside the focus flight. Another driver bumps the flight generation
    // (user zoom claims it on every step) and we yield, clearing the session
    // restore with it. Arrival clears the goal; arriving back at the restore
    // ends the session.
    if (r.dollyGoal !== null && target) {
      if (currentCameraFlight() !== r.dollyFlight) {
        r.dollyGoal = null
        r.dollyRestore = null
        r.dollyTween = null
      } else {
        const goal = r.dollyGoal
        const distance = camera.position.distanceTo(target)
        if (reduced) {
          r.dollyTween = null
          if (distance !== goal) setOrbitDistance(camera, target, goal, controlsRef.current)
        } else {
          const tween = r.dollyTween ?? { from: distance, to: goal, start: now }
          r.dollyTween = tween
          tween.to = goal
          const step = dollyFlightStep(tween.from, tween.to, tween.start, now, REFRAME_MS, reduced)
          if (step !== distance) setOrbitDistance(camera, target, step, controlsRef.current)
          if (
            tweenProgress(tween.start, now, REFRAME_MS) >= 1 ||
            Math.abs(step - goal) <= DOLLY_SNAP_M
          ) {
            setOrbitDistance(camera, target, goal, controlsRef.current)
            if (goal === r.dollyRestore) r.dollyRestore = null
            r.dollyGoal = null
            r.dollyTween = null
          } else {
            busy = true
          }
        }
      }
    }

    // View-offset flight with the panel; re-applied live on resize above.
    if (reduced) {
      r.offsetTween = null
      r.viewX = r.targetX
      r.viewY = r.targetY
    } else if (r.offsetTween) {
      const tween = r.offsetTween
      const progress = tweenProgress(tween.start, now, OFFSET_MS)
      r.viewX = flightAt(tween.fromX, tween.toX, progress)
      r.viewY = flightAt(tween.fromY, tween.toY, progress)
      if (
        progress >= 1 ||
        (Math.abs(r.viewX - r.targetX) <= OFFSET_SNAP_PX &&
          Math.abs(r.viewY - r.targetY) <= OFFSET_SNAP_PX)
      ) {
        r.viewX = r.targetX
        r.viewY = r.targetY
        r.offsetTween = null
      } else {
        busy = true
      }
    } else if (r.viewX !== r.targetX || r.viewY !== r.targetY) {
      r.offsetTween = {
        fromX: r.viewX,
        toX: r.targetX,
        fromY: r.viewY,
        toY: r.targetY,
        start: now,
      }
      busy = true
    }
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

    if (busy) invalidate()
  })

  return null
}
