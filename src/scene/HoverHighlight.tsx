// Hover highlight on the town-wide batches (D-032, fol-xo6): thin rig over
// `picking/hover`. Pointer movement picks the registry's per-group hit
// volumes (D-021, fol-hft),
// the hit vertex's `groupId` is already the global group-state slot (pack
// remapped it), and a per-slot spring eases lift+glow toward the hovered
// target. Slots are written through `materials/groupState` (one texel upload
// per write) only while still moving, so the demand loop settles once the
// hover rests (D-056).
//
// fol-l1r.5: under /cortico only the three pedestal slots lift (D-021) — the
// floor (slot 7) and the rest of town report through `data-hover` but never
// take lift, so one rig proves "only that pedestal" with no second system.
// Keyboard focus on the case links drives the same lift through the intent
// layer's FOCUS_LIFT_EVENT (spec: keyboard), mapped slug → slot here.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Raycaster, Vector2, Vector3 } from 'three'
import { FOCUS_LIFT_EVENT, type FocusLiftDetail } from '../input/intent'
import { clearGroupSlot, setGroupSlot } from '../materials/groupState'
import { shouldLiftSlot, slotForSlug } from '../panel/pedestals'
import { glowForNight, HOVER_LIFT, springTowards } from '../picking/hover'
import { pickSlotFromHit } from '../picking/pickSlot'
import { clearProjector, setCanvasHook, setProjector } from '../testHooks'
import { useLook } from '../time/lookContext'
import { useTownBatches } from './TownBatches'

interface SpringState {
  lift: number
  glow: number
}

/**
 * Eases one slot toward on/off. Returns whether the spring map changed (set
 * or delete): the rig rebuilds the `lifted` hook string only then, so rest
 * frames allocate nothing. Reads/writes nothing else.
 */
function stepSpring(
  springs: Map<number, SpringState>,
  slot: number,
  on: boolean,
  dt: number,
  glowTarget: number,
): boolean {
  const current = springs.get(slot)
  const fromLift = current?.lift ?? 0
  const fromGlow = current?.glow ?? 0
  const lift = springTowards(fromLift, on ? HOVER_LIFT : 0, dt)
  const glow = springTowards(fromGlow, on ? glowTarget : 0, dt)
  if (!on && lift === 0 && glow === 0) {
    if (springs.delete(slot)) {
      clearGroupSlot(slot)
      return true
    }
    return false
  }
  // At rest the values already equal the target: no write, no frame.
  if (current !== undefined && lift === fromLift && glow === fromGlow) return false
  springs.set(slot, { lift, glow })
  setGroupSlot(slot, lift, glow)
  return true
}

export function HoverHighlight() {
  const { meshes } = useTownBatches()
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const night = useLook().look.night

  const rig = useRef({
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    dirty: false,
    hovered: null as number | null,
    // Keyboard focus on a case link lifts that pedestal like a hover (spec:
    // keyboard). Pointer hover and focus compose: both lift while held.
    focusSlot: null as number | null,
    // Slot → current lift/glow easing toward (targeted ? on : off).
    springs: new Map<number, SpringState>(),
    // Scratch lifting set + cached `lifted` hook string, reused across
    // frames so the steady-state frame allocates nothing (fol-o3v).
    lifting: new Set<number>(),
    liftedCache: '',
  })

  useEffect(() => {
    const canvas = gl.domElement
    const setPointer = (event: PointerEvent) => {
      if (!event.isPrimary) return
      const rect = canvas.getBoundingClientRect()
      const r = rig.current
      r.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      r.dirty = true
      invalidate()
    }
    const onPointerMove = (event: PointerEvent) => {
      // Dragging orbits; the hover re-resolves on release instead.
      if (event.buttons !== 0) return
      setPointer(event)
    }
    // First tap lifts on touch, where there is no hover (spec: Navigation).
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      setPointer(event)
    }
    // Re-pick after an orbit lands the old hover on a new group.
    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary || event.pointerType === 'touch') return
      setPointer(event)
    }
    const onPointerLeave = () => {
      // Drop the queued raycast too, or the next frame re-hovers the stale
      // pointer over the leave's clear.
      rig.current.dirty = false
      rig.current.hovered = null
      setCanvasHook(canvas, 'hover', '')
      setCanvasHook(canvas, 'hoverSettled', '')
      invalidate()
    }
    setProjector(window, (world) => {
      const rect = canvas.getBoundingClientRect()
      const ndc = new Vector3(world[0], world[1], world[2]).project(camera)
      return {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndc.y) / 2) * rect.height,
      }
    })
    const onFocusLift = (event: Event) => {
      const targetId = (event as CustomEvent<FocusLiftDetail>).detail?.targetId ?? ''
      const slot = targetId === '' ? null : slotForSlug(targetId)
      if (slot === rig.current.focusSlot) return
      rig.current.focusSlot = slot
      setCanvasHook(canvas, 'hoverSettled', '')
      invalidate()
    }
    window.addEventListener(FOCUS_LIFT_EVENT, onFocusLift)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    return () => {
      window.removeEventListener(FOCUS_LIFT_EVENT, onFocusLift)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      clearProjector(window)
      // Leave no lifted groups behind on unmount.
      for (const slot of rig.current.springs.keys()) clearGroupSlot(slot)
      rig.current.springs.clear()
      rig.current.hovered = null
    }
  }, [camera, gl, invalidate])

  useFrame((_, rawDt) => {
    const r = rig.current
    // Floored so the spring always progresses: a same-tick zero-dt frame
    // after an invalidate must not read as "already at rest" and stall the
    // loop with the hover still easing.
    const dt = Math.min(Math.max(rawDt, 1 / 240), 0.05)
    if (r.dirty) {
      r.dirty = false
      const slot = pickSlotFromHit(meshes, r.raycaster, r.pointer, camera)
      if (slot !== r.hovered) {
        r.hovered = slot
        setCanvasHook(gl.domElement, 'hover', slot === null ? '' : String(slot))
        setCanvasHook(gl.domElement, 'hoverSettled', '')
      }
    }
    const glowTarget = glowForNight(night)
    // Under /cortico only pedestals take lift (D-021); the raw hovered slot
    // still reports through data-hover, so the filter itself is observable.
    // Read live: the canvas persists across route changes, so a captured
    // pathname would go stale. The scratch set is cleared and reused — no
    // per-frame Set allocation — and hover/focus compose with no candidate
    // collection at all.
    const pathname = window.location.pathname
    const lifting = r.lifting
    lifting.clear()
    if (r.hovered !== null && shouldLiftSlot(r.hovered, pathname)) lifting.add(r.hovered)
    if (
      r.focusSlot !== null &&
      r.focusSlot !== r.hovered &&
      shouldLiftSlot(r.focusSlot, pathname)
    ) {
      lifting.add(r.focusSlot)
    }
    // Allowed slots ease toward on; easing-out slots stay in the map until
    // they delete themselves at rest. Two passes over live collections, no
    // union set: updating or deleting the visited entry during Map iteration
    // is safe, and the second pass adds no keys (off-target rests at 0).
    let moved = false
    for (const slot of lifting) {
      moved = stepSpring(r.springs, slot, true, dt, glowTarget) || moved
    }
    for (const slot of r.springs.keys()) {
      if (lifting.has(slot)) continue
      moved = stepSpring(r.springs, slot, false, dt, glowTarget) || moved
    }
    let settled = !r.dirty && (lifting.size === 0 ? r.springs.size === 0 : true)
    if (settled) {
      for (const slot of lifting) {
        const state = r.springs.get(slot)
        if (state === undefined || state.lift !== HOVER_LIFT || state.glow !== glowTarget) {
          settled = false
          break
        }
      }
    }
    setCanvasHook(gl.domElement, 'hoverSettled', settled ? 'true' : '')
    // Which slots hold lift right now: the e2e proof that only the pedestal
    // lifts (data-hover still reports the raw slot, filtered or not). The
    // string is rebuilt only when the springs changed; the hook call itself
    // short-circuits on identical values, so rest frames write nothing.
    if (moved) {
      r.liftedCache = [...r.springs.entries()]
        .filter(([, state]) => state.lift > 0)
        .map(([slot]) => slot)
        .sort((a, b) => a - b)
        .join(',')
    }
    setCanvasHook(gl.domElement, 'lifted', r.liftedCache)
    // Settle-driven: any frame that leaves the hover easing (or a fresh
    // pointer unpicked) asks for the next one, so the loop can neither stall
    // early nor spin once everything rests.
    if (!settled) invalidate()
  })

  return null
}
