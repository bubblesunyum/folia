import { useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { type BloomEffect, EffectPass, SMAAEffect, ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import { HalfFloatType } from 'three'
import { renderConfig } from '../debug'
import { useLook } from '../time/lookContext'
import { GradeEffect } from './GradeEffect'

const MSAA_SAMPLES = 4

/**
 * The post chain: bloom, then tone mapping (owned here rather than by the
 * renderer, D-043, as Khronos PBR Neutral, R-006), then the grade (D-046).
 * Bloom and the grade follow the time of day through their uniforms, never
 * their props, so scrubbing doesn't rebuild the pass.
 *
 * `?bloom=off` drops bloom, leaving night to neon's fake glow (D-038).
 *
 * Antialiasing is MSAA on the scene pass by default (D-055). `?aa=smaa` runs
 * SMAA instead, in a pass of its own after the grade: merged into the effect
 * pass it would read the raw scene buffer, and its edge pixels would skip
 * bloom, tone mapping and grade.
 */
export function Effects() {
  const { look } = useLook()
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const bloom = useRef<BloomEffect>(null)
  const grade = useMemo(() => new GradeEffect(), [])
  const smaa = useMemo(
    () => (renderConfig.aa === 'smaa' ? new EffectPass(camera, new SMAAEffect()) : null),
    [camera],
  )

  useEffect(() => {
    grade.apply(look)
    const effect = bloom.current
    if (!effect) return
    effect.intensity = look.bloom.intensity
    effect.luminanceMaterial.threshold = look.bloom.threshold
    effect.luminanceMaterial.smoothing = look.bloom.smoothing
    invalidate()
  }, [look, grade, invalidate])

  return (
    <EffectComposer
      multisampling={renderConfig.aa === 'msaa' ? MSAA_SAMPLES : 0}
      frameBufferType={HalfFloatType}
    >
      {renderConfig.bloom && <Bloom ref={bloom} mipmapBlur levels={6} />}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <primitive object={grade} dispose={null} />
      {smaa && <primitive object={smaa} dispose={null} />}
    </EffectComposer>
  )
}
