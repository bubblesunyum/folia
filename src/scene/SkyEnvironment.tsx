import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Color,
  CubeCamera,
  FogExp2,
  HalfFloatType,
  Mesh,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { useContextRestores } from '../renderer/contextRestores'
import { shouldRegenEnv, skyKey } from '../time/envTrigger'
import { useLook } from '../time/lookContext'
import { applySky, createSkyMaterial } from './skyMaterial'

// 256 px, because r186 sizes the PMREM from its source cube (D-040).
const CUBE_SIZE = 256

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
 * and fog tweaks never pay for a PMREM rebuild. No hemisphere light: the env
 * supplies both diffuse and specular ambient.
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
    const key = skyKey(look)
    if (shouldRegenEnv(lastSun.current, sun.direction, lastSky.current, key)) {
      applySky(env.sky, look, sun.direction)
      scene.environment = env.render()
      scene.background = env.background
      lastSun.current = [...sun.direction]
      lastSky.current = key
    }
    scene.environmentIntensity = look.env.intensity
    invalidate()
  }, [scene, look, sun, restores, invalidate])

  // Distance fog from the look (D-046). Interim: FogExp2 carries the distance
  // half; the height half lives in look.fog (interpolated, tested) but has no
  // consumer until a composer height-fog injection exists. Constructed empty
  // and filled from the look below, so no palette-external literal (D-024).
  useEffect(() => {
    const fog =
      scene.fog instanceof FogExp2
        ? scene.fog
        : new FogExp2(new Color().fromArray(look.fog.color), look.fog.density)
    if (scene.fog !== fog) scene.fog = fog
    fog.color.fromArray(look.fog.color)
    fog.density = look.fog.density
    invalidate()
  }, [scene, look, invalidate])

  return null
}
