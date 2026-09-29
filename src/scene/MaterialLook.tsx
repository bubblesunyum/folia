import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { renderConfig } from '../debug'
import { applyLook } from '../materials/shared'
import { useLook } from '../time/lookContext'

/** Keeps the shared materials on the current look; mounted once per scene, not per asset. */
export function MaterialLook() {
  const { look, palette } = useLook()
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    applyLook(look, renderConfig.bloom, palette)
    // Tests read this rather than pixels.
    canvas.dataset.sun = look.sun.intensity.toFixed(2)
    invalidate()
  }, [look, palette, canvas, invalidate])
  return null
}
