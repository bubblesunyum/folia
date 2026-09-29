import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { applyLook } from '../materials/shared'
import { useLook } from '../time/lookContext'

/** Keeps the shared materials on the current look; mounted once per scene, not per asset. */
export function MaterialLook() {
  const { look } = useLook()
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    applyLook(look)
    invalidate()
  }, [look, invalidate])
  return null
}
