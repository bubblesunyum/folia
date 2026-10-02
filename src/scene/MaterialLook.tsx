import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { renderConfig } from '../debug'
import { applyLook } from '../materials/shared'
import { setCanvasHook } from '../testHooks'
import { useLook } from '../time/lookContext'
import { useHood } from '../useHood'

/** Keeps the shared materials on the current look; mounted once per scene, not per asset. */
export function MaterialLook() {
  const { look, palette } = useLook()
  const hood = useHood()
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    applyLook(look, renderConfig.bloom, palette, hood)
    // Tests read this rather than pixels.
    setCanvasHook(canvas, 'sun', look.sun.intensity.toFixed(2))
    invalidate()
  }, [look, palette, hood, canvas, invalidate])
  return null
}
