import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { applyLook } from '../materials/shared'
import { useEffectiveTier } from '../perf/qualityTiers'
import { setCanvasHook } from '../testHooks'
import { useLook } from '../time/lookContext'
import { useHood } from '../useHood'

/**
 * Keeps the shared materials on the current look; mounted once per scene, not
 * per asset. The single `applyLook` writer: the tier-effective bloom rides the
 * tier subscription, so the fake-glow scale follows the rung with no second
 * writer in TierRig (D-036, D-038).
 */
export function MaterialLook() {
  const { look, palette } = useLook()
  const hood = useHood()
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const tier = useEffectiveTier()
  useEffect(() => {
    applyLook(look, tier.bloom, palette, hood)
    // Tests read this rather than pixels.
    setCanvasHook(canvas, 'sun', look.sun.intensity.toFixed(2))
    invalidate()
  }, [look, palette, hood, canvas, invalidate, tier])
  return null
}
