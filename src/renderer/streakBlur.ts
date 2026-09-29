// A vertical-only blur that pulls a thin light into a long soft streak (D-039),
// in three separable passes whose tap spacing triples each time, so nine taps
// a pass reach far without leaving stacked copies of the light.

import { ShaderMaterial, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

/** Tap spacing of the first pass, in texels; each later pass is 3× the one before. */
const FIRST_STEP = 1.5
/** Odd, so the last pass writes `scratch`. */
const PASSES = 3

const streakMaterial = (uniforms: {
  tSource: { value: Texture | null }
  uStep: { value: number }
}) =>
  new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform float uStep;
      varying vec2 vUv;
      void main() {
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int i = -4; i <= 4; i++) {
          float w = exp(-float(i * i) / 8.0);
          sum += w * texture2D(tSource, vUv + vec2(0.0, float(i) * uStep)).rgb;
          total += w;
        }
        gl_FragColor = vec4(sum / total, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  })

export function createStreakBlur() {
  const uniforms = { tSource: { value: null as Texture | null }, uStep: { value: 0 } }
  const blur = streakMaterial(uniforms)
  const quad = new FullScreenQuad(blur)
  return {
    /** Blurs `source` in place of `scratch`, ping-ponging; the result lands in `scratch`. */
    render(gl: WebGLRenderer, source: WebGLRenderTarget, scratch: WebGLRenderTarget) {
      const texel = 1 / source.height
      let from = source
      let to = scratch
      for (let pass = 0; pass < PASSES; pass++) {
        uniforms.tSource.value = from.texture
        uniforms.uStep.value = FIRST_STEP * 3 ** pass * texel
        gl.setRenderTarget(to)
        quad.render(gl)
        ;[from, to] = [to, from]
      }
    },
    dispose() {
      blur.dispose()
      quad.dispose()
    },
  }
}
