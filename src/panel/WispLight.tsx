// The placeholder glowing wisp that stands in for Poppy (fol-l1r.5, D-010):
// a point light, a sprite and a bob, easing to a perch above the open case's
// pedestal. The light is always in the scene — intensity 0 when hidden — so
// the dynamic light count is fixed at boot (D-038). Poppy and the particle
// materialize replace this component behind the PanelPresenter seam without
// touching routing or content.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { readReducedMotion } from '../input/intent'
import { signatureColor } from '../palette'
import { getCaseInView, onCaseInView } from './caseInView'
import { PEDESTAL_ANCHOR_BY_SLUG, type PedestalSlug } from './pedestals'

/** The perch floats this far above the pedestal anchor. */
export const WISP_PERCH_HEIGHT_M = 1.15
/** Gentle bob amplitude and rate while the panel is open. */
export const WISP_BOB_M = 0.12
export const WISP_BOB_RATE = 2.2

const EASE_RATE = 4
const ARRIVE_M = 0.02

/** Scratch perch target, reused every frame while the wisp is out. */
const scratchHome = new THREE.Vector3()

let glowTexture: THREE.CanvasTexture | null = null

/** A soft radial glow sprite map, built once and shared. */
function wispGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) throw new Error('wisp: no 2d context for the glow sprite')
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

export function WispLight() {
  const invalidate = useThree((state) => state.invalidate)
  const group = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const sprite = useRef<THREE.Sprite>(null)
  const rig = useRef({ slug: null as PedestalSlug | null, phase: 0 })
  const map = useMemo(() => wispGlowTexture(), [])

  useEffect(() => {
    rig.current.slug = getCaseInView()
    invalidate()
    return onCaseInView((slug) => {
      rig.current.slug = slug
      invalidate()
    })
  }, [invalidate])

  useFrame(({ clock }, rawDt) => {
    const node = group.current
    const lamp = light.current
    const dot = sprite.current
    if (!node || !lamp || !dot) return
    const dt = Math.min(Math.max(rawDt, 1 / 240), 0.05)
    const slug = rig.current.slug
    const reduced = readReducedMotion()
    if (slug === null) {
      if (lamp.intensity !== 0) {
        lamp.intensity = 0
        dot.visible = false
        invalidate()
      }
      return
    }
    const anchor = PEDESTAL_ANCHOR_BY_SLUG[slug]
    scratchHome.set(anchor[0], anchor[1] + WISP_PERCH_HEIGHT_M, anchor[2])
    if (reduced) {
      node.position.copy(scratchHome)
    } else if (node.position.distanceTo(scratchHome) > ARRIVE_M) {
      node.position.lerp(scratchHome, 1 - Math.exp(-EASE_RATE * dt))
      if (node.position.distanceTo(scratchHome) <= ARRIVE_M) node.position.copy(scratchHome)
    }
    if (lamp.intensity === 0) {
      lamp.intensity = 20
      dot.visible = true
    }
    rig.current.phase = reduced ? 0 : clock.elapsedTime * WISP_BOB_RATE
    dot.position.y = reduced ? 0 : Math.sin(rig.current.phase) * WISP_BOB_M
    invalidate()
  })

  return (
    <group ref={group} position={[0, -10, 0]}>
      <pointLight
        ref={light}
        intensity={0}
        distance={14}
        decay={2}
        color={signatureColor('cortico')}
      />
      <sprite ref={sprite} scale={[0.9, 0.9, 1]} visible={false}>
        <spriteMaterial
          map={map}
          color={signatureColor('cortico')}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  )
}
