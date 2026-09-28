import { useEffect } from 'react'
import { applyLook } from '../materials/shared'
import { useLook } from '../time/lookContext'

/** Keeps the shared materials on the current look; mounted once per scene, not per asset. */
export function MaterialLook() {
  const { look } = useLook()
  useEffect(() => applyLook(look), [look])
  return null
}
