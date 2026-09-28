// The grade (D-046): lift/gamma/gain, saturation and a warm/cool split tone,
// after tone mapping and merged into the same EffectPass. Params come from the
// time-of-day keyframes.

import { Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'
import type { Look } from '../time/look'

const fragment = /* glsl */ `
  uniform vec3 uLift;
  uniform vec3 uGamma;
  uniform vec3 uGain;
  uniform float uSaturation;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uSplit;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = uGain * (inputColor.rgb + uLift * (1.0 - inputColor.rgb));
    c = pow(max(c, 0.0), 1.0 / uGamma);
    float luma = dot(c, LUMA);
    c = mix(vec3(luma), c, uSaturation);
    vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.1, 0.7, luma));
    c *= mix(vec3(1.0), tint / max(dot(tint, LUMA), 1e-3), uSplit);
    outputColor = vec4(c, inputColor.a);
  }
`

const names = ['uLift', 'uGamma', 'uGain', 'uShadowTint', 'uHighlightTint'] as const

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ...names.map((name) => [name, new Uniform(new Vector3(1, 1, 1))] as const),
        ['uSaturation', new Uniform(1)],
        ['uSplit', new Uniform(0)],
      ]),
    })
  }

  apply({ grade }: Look): void {
    const vector = (name: (typeof names)[number]) => this.uniforms.get(name)?.value as Vector3
    vector('uLift').fromArray(grade.lift)
    vector('uGamma').fromArray(grade.gamma)
    vector('uGain').fromArray(grade.gain)
    vector('uShadowTint').fromArray(grade.shadowTint)
    vector('uHighlightTint').fromArray(grade.highlightTint)
    const scalar = (name: string, value: number) => {
      const uniform = this.uniforms.get(name)
      if (uniform) uniform.value = value
    }
    scalar('uSaturation', grade.saturation)
    scalar('uSplit', grade.split)
  }
}
