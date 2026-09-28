import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { HalfFloatType } from 'three'

/**
 * The post chain. Tone mapping lives here rather than on the renderer (D-043),
 * as Khronos PBR Neutral (R-006). Multisampling stays off until spike 3 picks
 * the AA mode (D-042).
 */
export function Effects() {
  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  )
}
