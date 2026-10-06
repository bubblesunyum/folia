import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  FLIGHT_SETTLE_EPS,
  flightAt,
  tweenProgress,
  YAW_SPRING_MS,
  ZOOM_STEP_MS,
} from '../motion/flight'
import { setOrbitDistance } from '../motion/orbit'
import { azimuthOf, rotateOffsetY, wheelPanScale, YAW_SNAP_RAD } from '../motion/orbitLimits'
import { type RiseCountHost, recordRise, setCanvasHook } from '../testHooks'
import { beginCameraFlight, currentCameraFlight } from './cameraFlight'
import { limitsForPath, yawStatusForOffset } from './cameraPresets'
import {
  isDismissKey,
  isPanelOpen,
  readReducedMotion,
  requestPanelClose,
  resolveEscape,
} from './intent'
import {
  gestureToZoomDelta,
  KEY_STEP,
  keyToZoomDelta,
  pinchToZoomDelta,
  RISE_EVENT,
  shouldIgnoreGestureWhilePinching,
  shouldIgnoreWheelDuringGesture,
  wheelToPan,
  wheelToZoomDelta,
  ZOOM_IN_EVENT,
  ZOOM_OUT_EVENT,
} from './sources'
import {
  applyZoomDelta,
  resolveZoomBase,
  shouldSnapZoom,
  type ZoomLimits,
  zoomRenderDistance,
} from './zoomModel'

/**
 * The town zoom limits (D-060's spike preset, kept as the town default so the
 * detent stays reachable in e2e). Other places resolve per route through
 * cameraPresets.limitsForPath; an explicit `limits` prop still wins (tests).
 */
export const ZOOM_LIMITS: ZoomLimits = { minDistance: 25, maxDistance: 90 }

interface ControlsLike {
  target: THREE.Vector3
  enablePan: boolean
  enableRotate?: boolean
  mouseButtons?: { LEFT?: number; MIDDLE?: number; RIGHT?: number }
  touches?: { ONE?: number; TWO?: number }
  update: () => void
}

/**
 * Drag pans (D-006, fol-j08): left-drag and one-finger touch pan instead of
 * rotating. The rig configures the shared OrbitControls imperatively (the
 * JSX lives in LookDevScene, outside this module): rotate off, LEFT and ONE
 * remapped to pan. Pan moves target and camera together, so the orbit offset
 * — and with it the pitch — is preserved by construction; the yaw spring
 * stays armed as the bounds safety net, not the driver.
 *
 * PENDING ON-DEVICE VERIFICATION (@bubbles): confirm drag-pan feel on the
 * Max trackpad / mouse and one-finger pan on the iPad (fol-j08 device check).
 */
export function applyDragPanConfig(controls: ControlsLike | null): () => void {
  if (!controls) return () => {}
  const previous = {
    enablePan: controls.enablePan,
    enableRotate: controls.enableRotate,
    left: controls.mouseButtons?.LEFT,
    one: controls.touches?.ONE,
  }
  if (controls.enableRotate !== undefined) controls.enableRotate = false
  if (controls.mouseButtons) controls.mouseButtons.LEFT = THREE.MOUSE.PAN
  if (controls.touches) controls.touches.ONE = THREE.TOUCH.PAN
  return () => {
    // Borrow-and-restore covers enablePan too: setup never changes it (only
    // the pinch-time toggle does), so unmount restores the setup value
    // instead of forcing true and stranding a setup that had pan off.
    controls.enablePan = previous.enablePan
    if (controls.enableRotate !== undefined) controls.enableRotate = previous.enableRotate
    if (controls.mouseButtons && previous.left !== undefined) {
      controls.mouseButtons.LEFT = previous.left
    }
    if (controls.touches && previous.one !== undefined) controls.touches.ONE = previous.one
  }
}

interface SafariGestureEvent extends Event {
  scale: number
}

function isGestureEvent(event: Event): event is SafariGestureEvent {
  return 'scale' in event && typeof (event as { scale: unknown }).scale === 'number'
}

/** Default orbit target, shared so the per-frame loop never allocates. */
const FALLBACK_TARGET = new THREE.Vector3(0, 2, 0)

/** Scratch pan vectors, reused every wheel-pan. */
const scratchRight = new THREE.Vector3()
const scratchUp = new THREE.Vector3()
const scratchPan = new THREE.Vector3()

/** Two-pointer pinch tracking: finger distance in CSS pixels feeds one delta. */
function createPinchTracker(onPinch: (delta: number) => void) {
  const pointers = new Map<number, { x: number; y: number }>()
  let previous: number | null = null
  const distance = () => {
    const points = [...pointers.values()]
    const a = points[0]
    const b = points[1]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  // Any count change re-baselines, so a transient third finger can't jump zoom.
  const rebase = () => {
    previous = pointers.size === 2 ? distance() : null
  }
  return {
    down(event: PointerEvent) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      rebase()
    },
    move(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size !== 2 || previous === null) return
      const current = distance()
      onPinch(pinchToZoomDelta(current, previous))
      previous = current
    },
    up(event: PointerEvent) {
      pointers.delete(event.pointerId)
      rebase()
    },
    get twoFinger() {
      return pointers.size === 2
    },
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

interface ZoomTween {
  fromDistance: number
  to: number
  start: number
  /** Camera-flight generation at creation: another driver cancels this. */
  flight: number
}

interface YawTween {
  fromAz: number
  toAz: number
  start: number
}

/** pathname without the query/hash, safe outside the browser. */
function currentPath(): string {
  if (typeof window === 'undefined' || typeof window.location?.pathname !== 'string') return '/'
  return window.location.pathname
}

/**
 * The input rig (D-048/D-006): ctrl+wheel, Safari GestureEvent and
 * two-pointer pinch all feed the one zoom model, with the resistance detent
 * past the Place's far limit; a plain wheel (two-finger swipe) pans like an
 * OrbitControls drag-pan. iOS fires gesture events for touch pinches alongside
 * the pointers, so the gesture channel stays silent while two fingers are
 * down (fol-crx). OrbitControls' own zoom stays off so there is exactly
 * one zoom path; left-drag and one-finger pan (rotate off, fol-j08), so
 * pitch cannot drift off the art-directed vantage and the yaw spring only
 * ever fires as a bounds safety net.
 *
 * fol-j08 PENDING ON-DEVICE VERIFICATION (@bubbles): the WHEEL/GESTURE/PINCH
 * gains are D-060 starting points kept as defaults, and the gesture +
 * ctrl+wheel double-count guard is code-only — confirm on a real Max
 * trackpad pinch (gesture vs ctrl+wheel co-occurrence) and an iPad pinch.
 *
 * Yaw follows the place preset (D-008): fixed at town, a limited orbit at a
 * neighborhood that springs back with the one easing once the user lets go.
 * The spring only ever arms off a real pointer release, so panel refocuses
 * and flights never fight it — and at rest it invalidates nothing (D-056).
 *
 * fol-etn: the rig keeps no cached distance. Every event re-reads the camera,
 * so a Phase 2 flight can move it without the next zoom snapping back; the
 * banked overscroll is the only thing carried across events, and an idle
 * camera found far from the last render resets it (a new Place). Interrupting
 * a tween resumes from its target, so rapid steps accumulate. The model
 * emits a render target (clamped distance plus visible detent give) and
 * discrete steps ease toward it with the one zoom easing; continuous sources
 * stay 1:1.
 */
export function ZoomRig({ limits }: { limits?: ZoomLimits }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const limitsPropRef = useRef(limits)
  limitsPropRef.current = limits
  const limitsRef = useRef<ZoomLimits>(limits ?? ZOOM_LIMITS)
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const overscrollRef = useRef(0)
  const lastRenderRef = useRef<number | null>(null)
  const tweenRef = useRef<ZoomTween | null>(null)
  const yawTweenRef = useRef<YawTween | null>(null)
  const yawArmedRef = useRef(false)
  const pointersDownRef = useRef(0)
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  // Discrete steps ease toward their render target on the one easing, and a
  // released orbit springs back to its preset yaw on the same curve.
  // Continuous input cancels the tween by writing a new one (or jumping
  // straight there). Other camera drivers claim via beginCameraFlight(); the
  // loop yields when its flight is stale. At rest (no tween, yaw arrived)
  // this invalidates nothing, so ?sway=off keeps resting at zero draws.
  useFrame(() => {
    const target = controlsRef.current?.target ?? FALLBACK_TARGET
    const tween = tweenRef.current
    if (tween) {
      // Another driver (the panel vantage dolly) took the camera: yield.
      if (tween.flight !== currentCameraFlight()) {
        tweenRef.current = null
      } else {
        const now = performance.now()
        const progress = tweenProgress(tween.start, now, ZOOM_STEP_MS)
        const renderDistance = flightAt(tween.fromDistance, tween.to, progress)
        setOrbitDistance(camera, target, renderDistance, controlsRef.current)
        const canvas = gl.domElement
        setCanvasHook(canvas, 'zoom', renderDistance.toFixed(2))
        if (progress >= 1 || Math.abs(tween.to - renderDistance) < FLIGHT_SETTLE_EPS) {
          tweenRef.current = null
          setOrbitDistance(camera, target, tween.to, controlsRef.current)
          setCanvasHook(canvas, 'zoom', camera.position.distanceTo(target).toFixed(2))
        }
        invalidateRef.current()
      }
    }

    // Yaw spring-back (D-008): only when armed off a pointer release and the
    // user is no longer driving. Panel refocuses move the target, never the
    // arm, so they can't start this.
    if (yawArmedRef.current && pointersDownRef.current === 0) {
      const offset: [number, number, number] = [
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
      ]
      const az = azimuthOf(offset)
      const { clamped, outOfRange } = yawStatusForOffset(offset, currentPath(), YAW_SNAP_RAD)
      if (!outOfRange) {
        yawTweenRef.current = null
        yawArmedRef.current = false
      } else {
        let yawTween = yawTweenRef.current
        if (!yawTween) {
          yawTween = { fromAz: az, toAz: clamped, start: performance.now() }
          yawTweenRef.current = yawTween
        }
        const now = performance.now()
        const progress = tweenProgress(yawTween.start, now, YAW_SPRING_MS)
        const step = flightAt(yawTween.fromAz, yawTween.toAz, progress)
        const turned = rotateOffsetY(offset, step - az)
        camera.position.set(target.x + turned[0], target.y + turned[1], target.z + turned[2])
        controlsRef.current?.update()
        if (progress >= 1) {
          yawTweenRef.current = null
          yawArmedRef.current = false
        }
        invalidateRef.current()
      }
    } else if (!tween) {
      yawTweenRef.current = null
    }
  })

  useEffect(() => {
    const canvas = gl.domElement
    const targetOf = () => controlsRef.current?.target ?? FALLBACK_TARGET

    /** The readout always measures the camera, so tests observe real motion. */
    const publishCamera = () => {
      setCanvasHook(canvas, 'zoom', camera.position.distanceTo(targetOf()).toFixed(2))
    }

    const dollyTo = (renderDistance: number) => {
      beginCameraFlight()
      const target = targetOf()
      setOrbitDistance(camera, target, renderDistance, controlsRef.current)
      publishCamera()
      invalidate()
    }

    const easeTo = (renderDistance: number) => {
      const fromDistance = camera.position.distanceTo(targetOf())
      if (shouldSnapZoom(renderDistance, fromDistance)) {
        tweenRef.current = null
        dollyTo(renderDistance)
        return
      }
      tweenRef.current = {
        fromDistance,
        to: renderDistance,
        start: performance.now(),
        flight: beginCameraFlight(),
      }
      invalidate()
    }

    /** The rise is only a signal: routing flies the camera in Phase 2. */
    const signalRise = () => {
      recordRise(canvas, window as unknown as RiseCountHost)
      window.dispatchEvent(new CustomEvent(RISE_EVENT))
      invalidate()
    }

    /** Per-place limits: an explicit prop wins, else the route's preset. */
    const activeLimits = (): ZoomLimits => {
      const next = limitsPropRef.current ?? limitsForPath(currentPath())
      limitsRef.current = next
      return next
    }

    // The pure computation lives in resolveZoomBase (unit-tested); this only
    // moves the ref bookkeeping in and out of it.
    const takeZoomBase = (): { distance: number; overscroll: number } => {
      const base = resolveZoomBase(
        {
          cameraDistance: camera.position.distanceTo(targetOf()),
          lastRender: lastRenderRef.current,
          overscroll: overscrollRef.current,
          tweenTo: tweenRef.current?.to ?? null,
        },
        activeLimits(),
      )
      if (base.interrupted) tweenRef.current = null
      if (base.external) overscrollRef.current = 0
      return { distance: base.distance, overscroll: base.overscroll }
    }

    // One model step shared by both input policies: updates the bank and the
    // last render target, returns the render distance to show. Null on junk.
    const stepModel = (delta: number): { renderDistance: number; risen: boolean } | null => {
      if (delta === 0 || !Number.isFinite(delta)) return null
      const { state, risen } = applyZoomDelta(takeZoomBase(), delta, limitsRef.current)
      overscrollRef.current = state.overscroll
      const renderDistance = zoomRenderDistance(state)
      lastRenderRef.current = renderDistance
      return { renderDistance, risen }
    }

    const zoomContinuous = (delta: number) => {
      const step = stepModel(delta)
      if (!step) return
      if (step.risen) {
        signalRise()
        easeTo(step.renderDistance)
        return
      }
      tweenRef.current = null
      dollyTo(step.renderDistance)
    }

    const zoomStepped = (delta: number) => {
      const step = stepModel(delta)
      if (!step) return
      if (step.risen) signalRise()
      easeTo(step.renderDistance)
    }

    // Trackpad swipe pans with OrbitControls' own feel (D-006): same pixels
    // move the same world as a drag-pan. Preserves distance, so the zoom
    // readout never moves on a pan.
    const panByPixels = (dx: number, dy: number) => {
      const target = targetOf()
      const rect = canvas.getBoundingClientRect()
      // The canvas camera is always perspective (Viewport): the one fov the
      // pan scale matches against OrbitControls' own _pan branch.
      const { fov } = camera as THREE.PerspectiveCamera
      const scale = wheelPanScale(camera.position.distanceTo(target), rect.height || 1, fov)
      if (scale === 0 || (dx === 0 && dy === 0)) return
      camera.updateMatrixWorld()
      scratchRight.setFromMatrixColumn(camera.matrix, 0)
      scratchUp.setFromMatrixColumn(camera.matrix, 1)
      scratchPan
        .copy(scratchRight)
        .multiplyScalar(-dx * scale)
        .addScaledVector(scratchUp, dy * scale)
      target.add(scratchPan)
      camera.position.add(scratchPan)
      controlsRef.current?.update()
      invalidate()
    }

    /** Whether the orbit sits outside its place window right now. */
    const yawOutOfRange = (): { clamped: number; outOfRange: boolean } => {
      const target = targetOf()
      return yawStatusForOffset(
        [camera.position.x - target.x, camera.position.y - target.y, camera.position.z - target.z],
        currentPath(),
        YAW_SNAP_RAD,
      )
    }

    /** Arm the spring off a release, or snap it under reduced motion. */
    const settleYawAfterRelease = () => {
      const { clamped, outOfRange } = yawOutOfRange()
      if (!outOfRange) {
        yawArmedRef.current = false
        yawTweenRef.current = null
        return
      }
      if (readReducedMotion()) {
        const target = targetOf()
        const offset: [number, number, number] = [
          camera.position.x - target.x,
          camera.position.y - target.y,
          camera.position.z - target.z,
        ]
        const turned = rotateOffsetY(offset, clamped - azimuthOf(offset))
        camera.position.set(target.x + turned[0], target.y + turned[1], target.z + turned[2])
        controlsRef.current?.update()
        yawArmedRef.current = false
        yawTweenRef.current = null
        invalidate()
        return
      }
      yawArmedRef.current = true
      yawTweenRef.current = null
      invalidate()
    }

    // Gesture-channel ownership (fol-j08): a Safari gesture owns its pinch,
    // so a co-occurring ctrl+wheel for the same fingers yields. Declared
    // before onWheel: the wheel handler closes over it.
    let gestureScale = 1
    let gestureActive = false

    const onWheel = (event: WheelEvent) => {
      // macOS trackpad pinch may arrive as ctrl+wheel alongside the gesture
      // events (fol-j08): while a gesture is active the gesture owns the
      // zoom, so the wheel channel yields instead of double-counting.
      // PENDING ON-DEVICE VERIFICATION: confirm the co-occurrence on hardware.
      if (shouldIgnoreWheelDuringGesture(gestureActive)) {
        event.preventDefault()
        return
      }
      const zoomDelta = wheelToZoomDelta(event)
      if (zoomDelta !== null) {
        event.preventDefault()
        zoomContinuous(zoomDelta)
        return
      }
      const pan = wheelToPan(event)
      if (pan === null) return
      event.preventDefault()
      panByPixels(pan.dx, pan.dy)
    }

    // OrbitControls would pan from the same two fingers (DOLLY_PAN), walking
    // the orbit target while the user only asked to zoom — suppress it.
    // Defined before the gesture handlers: iOS fires both for one pinch, and
    // the gesture channel yields while the tracker holds two fingers (fol-crx).
    const pinch = createPinchTracker(zoomContinuous)

    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
      gestureActive = true
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      if (!isGestureEvent(event)) return
      const scale = event.scale
      // iOS Safari fires gesture events for touch pinches alongside the
      // pointer events the tracker already counts (fol-crx): while two
      // fingers are down the pointers own the zoom, so the gesture channel
      // only keeps its baseline in sync instead of zooming a second time.
      if (!shouldIgnoreGestureWhilePinching(pinch.twoFinger)) {
        zoomContinuous(gestureToZoomDelta(scale, gestureScale))
      }
      gestureScale = scale
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
      gestureActive = false
    }

    const onPointerDown = (event: PointerEvent) => {
      pointersDownRef.current += 1
      // The user is driving: a spring in flight yields to the hand.
      yawArmedRef.current = false
      yawTweenRef.current = null
      pinch.down(event)
      if (controlsRef.current) controlsRef.current.enablePan = !pinch.twoFinger
    }
    const onPointerMove = (event: PointerEvent) => {
      pinch.move(event)
    }
    const onPointerUp = (event: PointerEvent) => {
      pointersDownRef.current = Math.max(pointersDownRef.current - 1, 0)
      pinch.up(event)
      if (controlsRef.current) controlsRef.current.enablePan = !pinch.twoFinger
      if (pointersDownRef.current === 0 && !pinch.twoFinger) settleYawAfterRelease()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      // One keyboard-intent layer (fol-l1r.10): Escape resolves through the
      // pure intent module — focused input, then panel close, then rise —
      // so the rig holds no branching of its own.
      if (isDismissKey(event.key)) {
        // Escape closes flight and orbit first: a zoom tween or an armed yaw
        // spring never outlives the dismissal (fol-l7d.11, spec keyboard).
        tweenRef.current = null
        yawTweenRef.current = null
        yawArmedRef.current = false
        const resolved = resolveEscape({
          panelOpen: isPanelOpen(),
          focusInEditable: isEditableTarget(event.target),
          // Routing owns place depth in Phase 2; until then there is always
          // a level above, so Escape rises (today's behaviour).
          canRise: true,
          reducedMotion: readReducedMotion(),
        })
        if (resolved.action === 'close-panel') {
          requestPanelClose(resolved.reducedMotion)
          return
        }
        if (resolved.action === 'rise-level') {
          signalRise()
          return
        }
        return
      }
      if (isEditableTarget(event.target)) return
      const delta = keyToZoomDelta(event.key)
      if (delta !== null) zoomStepped(delta)
    }
    const onZoomIn = () => zoomStepped(-KEY_STEP)
    const onZoomOut = () => zoomStepped(KEY_STEP)

    // Safari page-zoom must not eat the gesture; the canvas owns touch.
    // fol-j08: left-drag / one-finger pans (rotate off). Restored on
    // unmount so a hot reload never strands the shared controls.
    const restoreDragPan = applyDragPanConfig(controlsRef.current)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('gesturestart', onGestureStart, { passive: false })
    canvas.addEventListener('gesturechange', onGestureChange, { passive: false })
    canvas.addEventListener('gestureend', onGestureEnd, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(ZOOM_IN_EVENT, onZoomIn)
    window.addEventListener(ZOOM_OUT_EVENT, onZoomOut)
    const previousTouchAction = canvas.style.touchAction
    canvas.style.touchAction = 'none'
    lastRenderRef.current = camera.position.distanceTo(targetOf())
    publishCamera()
    return () => {
      tweenRef.current = null
      yawTweenRef.current = null
      yawArmedRef.current = false
      pointersDownRef.current = 0
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      canvas.removeEventListener('gestureend', onGestureEnd)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(ZOOM_IN_EVENT, onZoomIn)
      window.removeEventListener(ZOOM_OUT_EVENT, onZoomOut)
      canvas.style.touchAction = previousTouchAction
      restoreDragPan()
    }
  }, [camera, gl, invalidate])

  return null
}
