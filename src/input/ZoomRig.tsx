import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { type RiseCountHost, recordRise, setCanvasHook } from '../testHooks'
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
  wheelToZoomDelta,
  ZOOM_IN_EVENT,
  ZOOM_OUT_EVENT,
} from './sources'
import {
  applyZoomDelta,
  easeOutCubic,
  resolveZoomBase,
  ZOOM_SETTLE_EPS,
  ZOOM_STEP_DURATION_MS,
  type ZoomLimits,
  zoomRenderDistance,
} from './zoomModel'

/**
 * Spike-local preset standing in for the per-Place limits Phase 2 keeps in
 * content data (spec: camera system). The look-dev camera sits at ~65 m, so
 * the far limit is one scroll-push away and the detent is reachable in e2e.
 */
export const ZOOM_LIMITS: ZoomLimits = { minDistance: 25, maxDistance: 90 }

interface ControlsLike {
  target: THREE.Vector3
  enablePan: boolean
  update: () => void
}

interface SafariGestureEvent extends Event {
  scale: number
}

function isGestureEvent(event: Event): event is SafariGestureEvent {
  return 'scale' in event && typeof (event as { scale: unknown }).scale === 'number'
}

/** Arbitrary non-degenerate axis, so the dolly direction can never NaN. */
const FALLBACK_DIRECTION = new THREE.Vector3(1, 0.6, 1).normalize()

/** Default orbit target, shared so the per-frame loop never allocates. */
const FALLBACK_TARGET = new THREE.Vector3(0, 2, 0)

/** Scratch dolly direction, reused every frame while a tween is active. */
const scratchDirection = new THREE.Vector3()

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
  from: number
  to: number
  start: number
}

/**
 * The spike 7 input rig (D-048): ctrl+wheel, Safari GestureEvent and
 * two-pointer pinch all feed the one zoom model, with the resistance detent
 * past the far limit. iOS fires gesture events for touch pinches alongside
 * the pointers, so the gesture channel stays silent while two fingers are
 * down (fol-crx). OrbitControls keeps pan and rotate; its own zoom stays
 * off so there is exactly one zoom path.
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
export function ZoomRig({ limits = ZOOM_LIMITS }: { limits?: ZoomLimits }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const overscrollRef = useRef(0)
  const lastRenderRef = useRef<number | null>(null)
  const tweenRef = useRef<ZoomTween | null>(null)
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  // Discrete steps ease toward their render target. Continuous input cancels
  // the tween by writing a new one (or jumping straight there); Phase 2
  // flights own the camera and must clear tweenRef when they take over.
  useFrame(() => {
    const tween = tweenRef.current
    if (!tween) return
    const target = controlsRef.current?.target ?? FALLBACK_TARGET
    const now = performance.now()
    const t = Math.min(Math.max((now - tween.start) / ZOOM_STEP_DURATION_MS, 0), 1)
    const renderDistance = tween.from + (tween.to - tween.from) * easeOutCubic(t)
    const direction = scratchDirection.copy(camera.position).sub(target)
    if (direction.lengthSq() === 0) direction.copy(FALLBACK_DIRECTION)
    direction.normalize()
    camera.position.copy(target).addScaledVector(direction, renderDistance)
    controlsRef.current?.update()
    const canvas = gl.domElement
    setCanvasHook(canvas, 'zoom', renderDistance.toFixed(2))
    if (t >= 1 || Math.abs(tween.to - renderDistance) < ZOOM_SETTLE_EPS) {
      tweenRef.current = null
      camera.position.copy(target).addScaledVector(direction, tween.to)
      controlsRef.current?.update()
      setCanvasHook(canvas, 'zoom', camera.position.distanceTo(target).toFixed(2))
    }
    invalidateRef.current()
  })

  useEffect(() => {
    const canvas = gl.domElement
    const targetOf = () => controlsRef.current?.target ?? FALLBACK_TARGET

    /** The readout always measures the camera, so tests observe real motion. */
    const publishCamera = () => {
      setCanvasHook(canvas, 'zoom', camera.position.distanceTo(targetOf()).toFixed(2))
    }

    const dollyTo = (renderDistance: number) => {
      const target = targetOf()
      const direction = scratchDirection.copy(camera.position).sub(target)
      if (direction.lengthSq() === 0) direction.copy(FALLBACK_DIRECTION)
      direction.normalize()
      camera.position.copy(target).addScaledVector(direction, renderDistance)
      controlsRef.current?.update()
      publishCamera()
      invalidate()
    }

    const easeTo = (renderDistance: number) => {
      const from = camera.position.distanceTo(targetOf())
      if (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Math.abs(renderDistance - from) < ZOOM_SETTLE_EPS
      ) {
        tweenRef.current = null
        dollyTo(renderDistance)
        return
      }
      tweenRef.current = { from, to: renderDistance, start: performance.now() }
      invalidate()
    }

    /** The rise is only a signal: routing flies the camera in Phase 2. */
    const signalRise = () => {
      recordRise(canvas, window as unknown as RiseCountHost)
      window.dispatchEvent(new CustomEvent(RISE_EVENT))
      invalidate()
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
        limitsRef.current,
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

    const onWheel = (event: WheelEvent) => {
      const delta = wheelToZoomDelta(event)
      if (delta === null) return
      event.preventDefault()
      zoomContinuous(delta)
    }

    // OrbitControls would pan from the same two fingers (DOLLY_PAN), walking
    // the orbit target while the user only asked to zoom — suppress it.
    // Defined before the gesture handlers: iOS fires both for one pinch, and
    // the gesture channel yields while the tracker holds two fingers (fol-crx).
    const pinch = createPinchTracker(zoomContinuous)

    let gestureScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      if (!isGestureEvent(event)) return
      const scale = event.scale
      // iOS Safari fires gesture events for touch pinches alongside the
      // pointer events the tracker already counts (fol-crx): while two
      // fingers are down the pointers own the zoom, so the gesture channel
      // only keeps its baseline in sync instead of zooming a second time.
      if (!pinch.twoFinger) zoomContinuous(gestureToZoomDelta(scale, gestureScale))
      gestureScale = scale
    }

    const onPointerDown = (event: PointerEvent) => {
      pinch.down(event)
      if (controlsRef.current) controlsRef.current.enablePan = !pinch.twoFinger
    }
    const onPointerMove = (event: PointerEvent) => {
      pinch.move(event)
    }
    const onPointerUp = (event: PointerEvent) => {
      pinch.up(event)
      if (controlsRef.current) controlsRef.current.enablePan = !pinch.twoFinger
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      // One keyboard-intent layer (fol-l1r.10): Escape resolves through the
      // pure intent module — focused input, then panel close, then rise —
      // so the rig holds no branching of its own.
      if (isDismissKey(event.key)) {
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
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('gesturestart', onGestureStart, { passive: false })
    canvas.addEventListener('gesturechange', onGestureChange, { passive: false })
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
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(ZOOM_IN_EVENT, onZoomIn)
      window.removeEventListener(ZOOM_OUT_EVENT, onZoomOut)
      canvas.style.touchAction = previousTouchAction
      if (controlsRef.current) controlsRef.current.enablePan = true
    }
  }, [camera, gl, invalidate])

  return null
}
