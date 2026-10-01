// A soft radial glow sprite map, built once and shared (fol-8z6): the wisp's
// canvas glow, lifted out of WispLight so the texture builder is reusable and
// the document binding is explicit. Canvas-only (three + document); never
// import from the prerender graph (D-047).

import * as THREE from 'three'

let glowTexture: THREE.CanvasTexture | null = null

/** Cached 64px radial glow map; throws without a 2d context (fail closed). */
export function makeRadialGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  if (typeof document === 'undefined') throw new Error('glow sprite: no document')
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('glow sprite: no 2d context')
  const half = size / 2
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}
