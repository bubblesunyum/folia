import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  CubeCamera,
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
 * The env map and background, rendered from the sky scene and redrawn whenever
 * the time of day moves (D-040). No hemisphere light: the env supplies both
 * diffuse and specular ambient.
 */
export function SkyEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const restores = useContextRestores()
  const { look, sun } = useLook()
  const environment = useRef<ReturnType<typeof createEnvironment> | null>(null)

  // Keyed on restores: the cube and PMREM are lost with the context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restores is the rebuild trigger
  useEffect(() => {
    const env = createEnvironment(gl)
    environment.current = env
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
    applySky(env.sky, look, sun.direction)
    scene.environment = env.render()
    scene.background = env.background
    scene.environmentIntensity = look.env.intensity
    invalidate()
  }, [scene, look, sun, restores, invalidate])

  return null
}
