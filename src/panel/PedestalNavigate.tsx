// Click / second-tap routing off the pedestals (fol-l1r.5, D-021). A click
// (mouse) or a second tap on the same pedestal (touch; the first tap already
// lifted it through HoverHighlight) opens /cortico/<slug>; a clean miss over
// empty world with a panel open asks the panel to close (D-022). Drags orbit
// instead: a press that travels more than a few pixels never routes.

import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type BatchedMesh, Raycaster, Vector2 } from 'three'
import { readReducedMotion, requestPanelClose } from '../input/intent'
import { slotFromGroupId } from '../picking/hover'
import { useTownBatches } from '../scene/TownBatches'
import { getCaseInView, onCaseInView } from './caseInView'
import { requestCaseOpen } from './pedestalEvents'
import {
  isPedestalSlot,
  nextTapState,
  type PedestalSlug,
  pedestalOnlyForPath,
  slugForSlot,
} from './pedestals'

/** A press that travels further than this is an orbit, not a click. */
export const CLICK_DRAG_TOLERANCE_PX = 6

export function PedestalNavigate() {
  const { meshes } = useTownBatches()
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const rig = useRef({
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    downX: 0,
    downY: 0,
    downPointerType: 'mouse',
    armedTap: null as number | null,
  })

  useEffect(() => {
    const canvas = gl.domElement
    const pick = (clientX: number, clientY: number): number | null => {
      const rect = canvas.getBoundingClientRect()
      rig.current.pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      rig.current.raycaster.setFromCamera(rig.current.pointer, camera)
      const hits = rig.current.raycaster.intersectObjects([...meshes.values()], false)
      const hit = hits[0]
      if (!hit?.face) return null
      const geometry = (hit.object as BatchedMesh).geometry
      const attr = geometry.getAttribute('groupId')
      if (!attr) throw new Error('pedestal picking: batch has no groupId attribute')
      return slotFromGroupId((vertex) => attr.getX(vertex), hit.face.a)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return
      rig.current.downX = event.clientX
      rig.current.downY = event.clientY
      rig.current.downPointerType = event.pointerType
    }
    const onClick = (event: MouseEvent) => {
      // At town level pedestal taps do nothing (D-021 keeps / → /cortico).
      if (!pedestalOnlyForPath(window.location.pathname)) return
      const moved = Math.hypot(event.clientX - rig.current.downX, event.clientY - rig.current.downY)
      if (moved > CLICK_DRAG_TOLERANCE_PX) return
      const slot = pick(event.clientX, event.clientY)
      if (slot !== null && isPedestalSlot(slot)) {
        const step = nextTapState(rig.current.armedTap, slot, rig.current.downPointerType)
        rig.current.armedTap = step.armed
        if (step.action === 'open') {
          const slug: PedestalSlug | null = slugForSlot(slot)
          if (slug === null) throw new Error(`pedestal picking: slot ${slot} lost its slug`)
          requestCaseOpen(slug)
        }
        return
      }
      // A clean miss is the empty-world close; scenery hits hold the panel.
      if (slot === null && getCaseInView() !== null) {
        requestPanelClose(readReducedMotion())
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('click', onClick)
    // A route change (open/swap/close) disarms a stale first tap: the arm
    // belongs to the place it was tapped in, never the next one.
    const disarm = onCaseInView(() => {
      rig.current.armedTap = null
    })
    return () => {
      disarm()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('click', onClick)
    }
  }, [camera, gl, meshes])

  return null
}
