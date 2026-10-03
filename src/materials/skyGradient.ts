// The sky gradient shared by the background and the fog (D-046, fol-snu.4).
// `SkyEnvironment` renders the backdrop from this same GLSL and these same
// uniform objects; the composer's height fog samples the same gradient in the
// eye-to-fragment direction, so distant ground melts into the horizon behind
// it instead of a flat color. This is the one direction-to-color function both surfaces sample;
// a separate approximation would tint the seam differently. Uniforms are written by
// `applySkyGradient` from the same look + sun direction as the background,
// so golden hour and night agree; value writes only, never a recompile.

import { Vector3 } from 'three'
import type { Look } from '../time/look'

/** The sky parameters, in linear working space like the sky material. */
export const skyGradientUniforms = {
  uZenith: { value: new Vector3() },
  uHorizon: { value: new Vector3() },
  uGround: { value: new Vector3() },
  uGlow: { value: new Vector3() },
  uGlowIntensity: { value: 0 },
  uGlowSharpness: { value: 1 },
  uClouds: { value: 0 },
  uSunDirection: { value: new Vector3(0, 1, 0) },
}

/**
 * The sky shader's direction-to-color computation, uniform names included, so
 * the fog reads exactly what the background renders in that direction.
 */
export const SKY_GRADIENT_GLSL = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uGlow;
  uniform float uGlowIntensity;
  uniform float uGlowSharpness;
  uniform float uClouds;
  uniform vec3 uSunDirection;
  vec3 skyGradientColor(vec3 d) {
    float up = d.y;
    float toSun = max(dot(d, uSunDirection), 0.0);

    vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.6));
    sky += uGlow * uGlowIntensity * pow(toSun, uGlowSharpness) * smoothstep(-0.08, 0.04, up);

    float azimuth = atan(d.z, d.x);
    float band = smoothstep(0.02, 0.07, up) * (1.0 - smoothstep(0.1, 0.26, up));
    float streaks = 0.5 + 0.5 * sin(azimuth * 7.0 + 1.5 * sin(azimuth * 3.0)) * sin(up * 55.0);
    vec3 cloud = mix(uHorizon * 1.1, uGlow * 1.6, pow(toSun, 3.0));
    sky = mix(sky, cloud, uClouds * band * streaks);

    vec3 ground;
    {
      vec2 flatView = d.xz / max(length(d.xz), 1e-4);
      vec2 flatSun = uSunDirection.xz / max(length(uSunDirection.xz), 1e-4);
      float sunward = max(dot(flatView, flatSun), 0.0);
      float depth = smoothstep(0.05, 0.9, -up);
      float spill = pow(sunward, 4.0) * (1.0 - depth);
      ground = mix(uHorizon * 0.55, uGround, pow(depth, 0.6));
      ground += uGlow * (uGlowIntensity * 0.5) * spill;
    }
    return up < 0.0 ? ground : sky;
  }`

/**
 * Writes the fog's sky from the same inputs as the background: the look's
 * sky parameters and the sun direction. Called on every look change (unlike
 * the env-cube regen), so scrubbing recolors fog live. The sun direction is
 * optional so `applyLook` without a sun still refreshes the sky colors and
 * keeps the last sun; `SkyEnvironment` always passes the live sun.
 */
export function applySkyGradient(look: Look, sunDirection?: readonly number[]): void {
  const u = skyGradientUniforms
  u.uZenith.value.fromArray(look.sky.zenith)
  u.uHorizon.value.fromArray(look.sky.horizon)
  u.uGround.value.fromArray(look.sky.ground)
  u.uGlow.value.fromArray(look.sky.glow)
  if (sunDirection !== undefined) u.uSunDirection.value.fromArray(sunDirection)
  u.uGlowIntensity.value = look.sky.glowIntensity
  u.uGlowSharpness.value = look.sky.glowSharpness
  u.uClouds.value = look.sky.clouds
}
