import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BackSide,
  CubeCamera,
  HalfFloatType,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { applySkyGradient, SKY_GRADIENT_GLSL, skyGradientUniforms } from '../materials/skyGradient'
import { useContextRestores } from '../renderer/contextRestores'
import { shouldRegenEnv, skyKey } from '../time/envTrigger'
import { useLook } from '../time/lookContext'

// 256 px, because r186 sizes the PMREM from its source cube (D-040).
const CUBE_SIZE = 256

/**
 * The env-scene sky material: the SAME direction-to-color GLSL and the SAME
 * uniform objects the height fog samples (D-046, fol-snu.4). One
 * `applySkyGradient` write recolors both the baked background and the live
 * fog; value writes only, never a recompile.
 */
function createSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: skyGradientUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GRADIENT_GLSL}
      varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        gl_FragColor = vec4(skyGradientColor(d), 1.0);
      }`,
  })
}

function createEnvironment(gl: WebGLRenderer) {
  const sky = createSkyMaterial()
  const scene = new Scene()
  scene.add(new Mesh(new SphereGeometry(1, 48, 24), sky))
  const cube = new WebGLCubeRenderTarget(CUBE_SIZE, { type: HalfFloatType })
  const camera = new CubeCamera(0.1, 10, cube)
  const pmrem = new PMREMGenerator(gl)
  let prefiltered: WebGLRenderTarget | null = null
  return {
    sky,
    background: cube.texture,
    /** Redraws the sky into the cube and re-prefilters it; returns the env map. */
    render() {
      camera.update(gl, scene)
      prefiltered = pmrem.fromCubemap(cube.texture, prefiltered)
      return prefiltered.texture
    },
    dispose() {
      sky.dispose()
      cube.dispose()
      prefiltered?.dispose()
      pmrem.dispose()
    },
  }
}

/**
 * The env map, the background and the distance fog, all from the one look
 * (D-040, D-046). The cube re-renders only when it would change — first
 * frame, context restore, the sun past ~1°, or a new sky — so grade, bloom
 * and fog tweaks never pay for a PMREM rebuild. The sky uniforms are shared
 * with the height fog and rewritten from the same look + sun on every change,
 * so scrubbing recolors fog live while the baked cube waits for its regen.
 * No hemisphere light: the env supplies both diffuse and specular ambient.
 */
export function SkyEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const restores = useContextRestores()
  const { look, sun } = useLook()
  const environment = useRef<ReturnType<typeof createEnvironment> | null>(null)
  const lastSun = useRef<readonly number[] | null>(null)
  const lastSky = useRef<string | null>(null)

  // Keyed on restores: the cube and PMREM are lost with the context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restores is the rebuild trigger
  useEffect(() => {
    const env = createEnvironment(gl)
    environment.current = env
    // The fresh cube has never rendered: force the redraw below.
    lastSun.current = null
    lastSky.current = null
    return () => {
      env.dispose()
      environment.current = null
      scene.environment = null
      scene.background = null
    }
  }, [gl, scene, restores])

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw after a rebuild too
  useEffect(() => {
    const env = environment.current
    if (!env) return
    // Shared with the fog: the same look + sun recolors both, live.
    applySkyGradient(look, sun.direction)
    const key = skyKey(look)
    if (shouldRegenEnv(lastSun.current, sun.direction, lastSky.current, key)) {
      scene.environment = env.render()
      scene.background = env.background
      lastSun.current = [...sun.direction]
      lastSky.current = key
    }
    scene.environmentIntensity = look.env.intensity
    invalidate()
  }, [scene, look, sun, restores, invalidate])

  // Fog from the look (D-046, fol-snu.4): owned by the composer's height-fog
  // feature and driven by `applyLook` (see `MaterialLook`), so this component
  // keeps no `scene.fog` — a stock FogExp2 here would double-apply distance on
  // any material with built-in fog left on. No palette-external literal (D-024).

  return null
}
