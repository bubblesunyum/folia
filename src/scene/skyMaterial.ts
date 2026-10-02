// The env scene's sky (D-040): a gradient from horizon to zenith, an HDR glow
// lobe around the sun, low cloud bands warmed on the sun side, and a dark
// green ground hemisphere so gold and glossy cream reflect the forest, not a
// void. Rendered only into the env cube, in linear HDR.
//
// The town vantage looks down past the ground disc, so its whole backdrop is
// the below-horizon hemisphere (fol-1nr): the ground branch carries a warm
// gradient falling from the horizon plus an azimuthal sun lobe spilling past
// the horizon, all uniform-driven so night keeps its own spill. Without this
// the golden-hour frame is a flat dark-teal.

import { BackSide, ShaderMaterial, Vector3 } from 'three'
import type { Look } from '../time/look'

const skyUniforms = () => ({
  uZenith: { value: new Vector3() },
  uHorizon: { value: new Vector3() },
  uGround: { value: new Vector3() },
  uGlow: { value: new Vector3() },
  uGlowIntensity: { value: 0 },
  uGlowSharpness: { value: 1 },
  uClouds: { value: 0 },
  uSunDirection: { value: new Vector3(0, 1, 0) },
})

export type SkyMaterial = ShaderMaterial & { uniforms: ReturnType<typeof skyUniforms> }

export function createSkyMaterial(): SkyMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: skyUniforms(),
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uGlow;
      uniform float uGlowIntensity;
      uniform float uGlowSharpness;
      uniform float uClouds;
      uniform vec3 uSunDirection;
      varying vec3 vDirection;

      void main() {
        vec3 d = normalize(vDirection);
        float up = d.y;
        float toSun = max(dot(d, uSunDirection), 0.0);

        vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.6));
        sky += uGlow * uGlowIntensity * pow(toSun, uGlowSharpness) * smoothstep(-0.08, 0.04, up);

        float azimuth = atan(d.z, d.x);
        float band = smoothstep(0.02, 0.07, up) * (1.0 - smoothstep(0.1, 0.26, up));
        float streaks = 0.5 + 0.5 * sin(azimuth * 7.0 + 1.5 * sin(azimuth * 3.0)) * sin(up * 55.0);
        vec3 cloud = mix(uHorizon * 1.1, uGlow * 1.6, pow(toSun, 3.0));
        sky = mix(sky, cloud, uClouds * band * streaks);

        vec3 ground = mix(uHorizon * 0.35, uGround, smoothstep(0.0, 0.12, -up));
        // Below-horizon golden-hour read (fol-1nr): a warm gradient falling
        // from the horizon into the dark-green ground, plus an azimuthal sun
        // lobe that spills past the horizon. Sunward rays glow even looking
        // down, while away-from-sun stays forest; the slow depth falloff keeps
        // deep-below grounded in dark green. Uniform-driven, so each keyframe
        // (golden warmth, night lavender, midday haze) keeps its own spill.
        {
          vec2 flatView = d.xz / max(length(d.xz), 1e-4);
          vec2 flatSun = uSunDirection.xz / max(length(uSunDirection.xz), 1e-4);
          float sunward = max(dot(flatView, flatSun), 0.0);
          float depth = smoothstep(0.05, 0.9, -up);
          float spill = pow(sunward, 4.0) * (1.0 - depth);
          ground = mix(uHorizon * 0.55, uGround, pow(depth, 0.6));
          ground += uGlow * (uGlowIntensity * 0.5) * spill;
        }
        gl_FragColor = vec4(up < 0.0 ? ground : sky, 1.0);
      }`,
  }) as SkyMaterial
}

export function applySky(material: SkyMaterial, look: Look, sunDirection: readonly number[]): void {
  const u = material.uniforms
  u.uZenith.value.fromArray(look.sky.zenith)
  u.uHorizon.value.fromArray(look.sky.horizon)
  u.uGround.value.fromArray(look.sky.ground)
  u.uGlow.value.fromArray(look.sky.glow)
  u.uSunDirection.value.fromArray(sunDirection)
  u.uGlowIntensity.value = look.sky.glowIntensity
  u.uGlowSharpness.value = look.sky.glowSharpness
  u.uClouds.value = look.sky.clouds
}
