import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
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
import { applyZoomDelta, type ZoomLimits, type ZoomState } from './zoomModel'

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

/**
 * The spike 7 input rig (D-048): ctrl+wheel, Safari GestureEvent and
 * two-pointer pinch all feed the one zoom model, with the resistance detent
 * past the far limit. OrbitControls keeps pan and rotate; its own zoom stays
 * off so there is exactly one zoom path.
 */
export function ZoomRig({ limits = ZOOM_LIMITS }: { limits?: ZoomLimits }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useThree((state) => state.controls as unknown as ControlsLike | null)
  const stateRef = useRef<ZoomState | null>(null)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  useEffect(() => {
    const canvas = gl.domElement
    const targetOf = () => controlsRef.current?.target ?? new THREE.Vector3(0, 2, 0)
    const riseCount = () => Number(canvas.dataset.rises ?? 0)

    /** The readout always measures the camera, so tests observe real motion. */
    const publishZoom = (state: ZoomState) => {
      canvas.dataset.zoom = camera.position.distanceTo(targetOf()).toFixed(2)
      canvas.dataset.rises = String(riseCount())
      stateRef.current = state
    }

    const ensureState = (): ZoomState => {
      const current = stateRef.current
      if (current) return current
      const fresh = {
        distance: camera.position.distanceTo(targetOf()),
        overscroll: 0,
      }
      publishZoom(fresh)
      return fresh
    }

    /** The rise is only a signal: routing flies the camera in Phase 2. */
    const signalRise = () => {
      const counted = (window as unknown as { foliaRiseCount?: number }).foliaRiseCount ?? 0
      ;(window as unknown as { foliaRiseCount?: number }).foliaRiseCount = counted + 1
      canvas.dataset.rises = String(riseCount() + 1)
      window.dispatchEvent(new CustomEvent(RISE_EVENT))
      invalidate()
    }

    const zoomBy = (delta: number) => {
      if (delta === 0 || !Number.isFinite(delta)) return
      const target = targetOf()
      const { state, risen } = applyZoomDelta(ensureState(), delta, limitsRef.current)
      if (risen) {
        stateRef.current = state
        signalRise()
        return
      }
      const direction = camera.position.clone().sub(target)
      if (direction.lengthSq() === 0) direction.copy(FALLBACK_DIRECTION)
      direction.normalize()
      camera.position.copy(target).addScaledVector(direction, state.distance)
      controlsRef.current?.update()
      publishZoom(state)
      invalidate()
    }

    const onWheel = (event: WheelEvent) => {
      const delta = wheelToZoomDelta(event)
      if (delta === null) return
      event.preventDefault()
      zoomBy(delta)
    }

    let gestureScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      if (!isGestureEvent(event)) return
      zoomBy(gestureToZoomDelta(event.scale, gestureScale))
      gestureScale = event.scale
    }

    // OrbitControls would pan from the same two fingers (DOLLY_PAN), walking
    // the orbit target while the user only asked to zoom — suppress it.
    const pinch = createPinchTracker(zoomBy)
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
      if (isEditableTarget(event.target)) return
      if (event.key === 'Escape') {
        signalRise()
        return
      }
      const delta = keyToZoomDelta(event.key)
      if (delta !== null) zoomBy(delta)
    }
    const onZoomIn = () => zoomBy(-KEY_STEP)
    const onZoomOut = () => zoomBy(KEY_STEP)

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
    ensureState()
    return () => {
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
