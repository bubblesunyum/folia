import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { type BloomEffect, ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import { HalfFloatType } from 'three'
import { useLook } from '../time/lookContext'
import { GradeEffect } from './GradeEffect'

/**
 * The post chain: bloom, then tone mapping (owned here rather than by the
 * renderer, D-043, as Khronos PBR Neutral, R-006), then the grade (D-046).
 * Bloom and the grade follow the time of day through their uniforms, never
 * their props, so scrubbing doesn't rebuild the pass. Multisampling stays off
 * until spike 3 picks the AA mode (D-042).
 */
export function Effects() {
  const { look } = useLook()
  const bloom = useRef<BloomEffect>(null)
  const grade = useMemo(() => new GradeEffect(), [])

  useEffect(() => {
    grade.apply(look)
    const effect = bloom.current
    if (!effect) return
    effect.intensity = look.bloom.intensity
    effect.luminanceMaterial.threshold = look.bloom.threshold
    effect.luminanceMaterial.smoothing = look.bloom.smoothing
  }, [look, grade])

  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <Bloom ref={bloom} mipmapBlur levels={6} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <primitive object={grade} dispose={null} />
    </EffectComposer>
  )
}
