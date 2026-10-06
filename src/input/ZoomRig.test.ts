import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyDragPanConfig } from './ZoomRig'

describe('one reduced-motion reader', () => {
  it('ZoomRig holds no local matchMedia query', () => {
    const source = readFileSync(new URL('./ZoomRig.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('window.matchMedia')
    expect(source).not.toContain('.matchMedia(')
    expect(source).not.toContain('prefers-reduced-motion')
    expect(source).toContain('readReducedMotion')
  })
})

describe('fol-j08 drag pans', () => {
  it('turns rotate off and remaps left-drag / one-finger to pan', () => {
    const controls = {
      target: new THREE.Vector3(0, 2, 0),
      enablePan: true,
      enableRotate: true,
      mouseButtons: { LEFT: THREE.MOUSE.ROTATE },
      touches: { ONE: THREE.TOUCH.ROTATE },
      update: () => {},
    }
    const restore = applyDragPanConfig(controls)
    expect(controls.enableRotate).toBe(false)
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN)
    expect(controls.touches.ONE).toBe(THREE.TOUCH.PAN)
    restore()
    expect(controls.enableRotate).toBe(true)
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE)
    expect(controls.touches.ONE).toBe(THREE.TOUCH.ROTATE)
  })

  it('is a no-op without controls', () => {
    expect(() => applyDragPanConfig(null)()).not.toThrow()
  })

  it('marks the pending on-device verification in source', () => {
    const source = readFileSync(new URL('./ZoomRig.tsx', import.meta.url), 'utf8')
    expect(source).toContain('PENDING ON-DEVICE VERIFICATION')
  })
})
