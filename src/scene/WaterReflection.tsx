import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  type BatchedMesh,
  Box3,
  Color,
  HalfFloatType,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import { water } from '../materials/water'
import { createStreakBlur } from '../renderer/streakBlur'
import { useTownBatches } from './TownBatches'

/** Batches the mirrored pass draws lit; everything else opaque draws black, to occlude. */
const EMISSIVE = new Set(['neon'])
/** Batches left out of the mirrored pass entirely. */
const SKIPPED = new Set(['water', 'neonGlow'])
const BLACK = new Color(0, 0, 0)
/** Keeps the oblique near plane just under the water, so the pool's own edge doesn't clip. */
const CLIP_BIAS = 0.003
// Maps clip space [-1, 1] to texture space [0, 1].
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

/**
 * The water's quarter-res mirrored pass (D-039): the neon, and the opaque
 * batches as black occluders, drawn from the camera mirrored in the pool's
 * plane, with an oblique near plane cutting away everything under it, then
 * blurred into vertical streaks. The water program reads it through
 * `uReflectionMatrix`. Runs
 * inside the frame, before the composer, so it costs nothing while idle (D-056).
 */
export function WaterReflection() {
  const gl = useThree((state) => state.gl)
  const { meshes } = useTownBatches()
  const pass = useMemo(() => {
    return {
      target: new WebGLRenderTarget(1, 1, { type: HalfFloatType }),
      streaks: new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }),
      blur: createStreakBlur(),
      camera: new PerspectiveCamera(),
      occluder: new MeshBasicMaterial({ color: BLACK }),
      size: new Vector2(),
      clearColor: new Color(),
      box: new Box3(),
      plane: new Plane(),
      normal: new Vector3(0, 1, 0),
      point: new Vector3(),
      eye: new Vector3(),
      look: new Vector3(),
      rotation: new Matrix4(),
      clip: new Vector4(),
      q: new Vector4(),
      viewPlane: new Plane(),
      mirrored: new Vector3(),
      swapped: new Map<BatchedMesh, { material: Material; visible: boolean }>(),
    }
  }, [])

  useEffect(() => {
    water.uniforms.uReflection.value = pass.streaks.texture
    water.uniforms.uReflectionStrength.value = 1
    return () => {
      water.uniforms.uReflection.value = null
      water.uniforms.uReflectionStrength.value = 0
      pass.target.dispose()
      pass.streaks.dispose()
      pass.blur.dispose()
      pass.occluder.dispose()
    }
  }, [pass])

  useFrame(({ camera, scene }) => {
    // The town-wide batches, straight from the registry that owns them.
    const pool = meshes.get('water')
    if (!pool) return
    const p = pass

    // Quarter the pixels of the drawing buffer: half each side.
    gl.getDrawingBufferSize(p.size)
    const width = Math.max(1, Math.floor(p.size.x / 2))
    const height = Math.max(1, Math.floor(p.size.y / 2))
    if (p.target.width !== width || p.target.height !== height) {
      p.target.setSize(width, height)
      p.streaks.setSize(width, height)
    }

    // The pool is flat; its plane is the top of its bounds.
    if (!pool.boundingBox) pool.computeBoundingBox()
    p.box.copy(pool.boundingBox as Box3).applyMatrix4(pool.matrixWorld)
    p.point.set(0, p.box.max.y, 0)
    p.plane.setFromNormalAndCoplanarPoint(p.normal, p.point)

    // Mirror the camera's position, forward point and up in the plane.
    camera.getWorldPosition(p.eye)
    if (p.plane.distanceToPoint(p.eye) <= 0) return
    p.rotation.extractRotation(camera.matrixWorld)
    p.look.set(0, 0, -1).applyMatrix4(p.rotation).add(p.eye)
    const mirrorInPlace = (v: Vector3) => v.sub(p.point).reflect(p.normal).add(p.point)
    p.camera.position.copy(mirrorInPlace(p.mirrored.copy(p.eye)))
    p.camera.up.set(0, 1, 0).applyMatrix4(p.rotation).reflect(p.normal)
    p.camera.lookAt(mirrorInPlace(p.look))
    p.camera.updateMatrixWorld()
    p.camera.projectionMatrix.copy(camera.projectionMatrix)
    p.camera.layers.mask = camera.layers.mask

    water.uniforms.uReflectionMatrix.value
      .copy(BIAS)
      .multiply(p.camera.projectionMatrix)
      .multiply(p.camera.matrixWorldInverse)

    // Oblique near plane (Lengyel): the projection's near plane becomes the
    // water plane, so nothing under it (the terrace the pool sits on) draws.
    const viewPlane = p.viewPlane.copy(p.plane).applyMatrix4(p.camera.matrixWorldInverse)
    p.clip.set(viewPlane.normal.x, viewPlane.normal.y, viewPlane.normal.z, viewPlane.constant)
    const e = p.camera.projectionMatrix.elements
    p.q.set(
      (Math.sign(p.clip.x) + (e[8] ?? 0)) / (e[0] ?? 1),
      (Math.sign(p.clip.y) + (e[9] ?? 0)) / (e[5] ?? 1),
      -1,
      (1 + (e[10] ?? 0)) / (e[14] ?? 1),
    )
    p.clip.multiplyScalar(2 / p.clip.dot(p.q))
    e[2] = p.clip.x
    e[6] = p.clip.y
    e[10] = p.clip.z + 1 - CLIP_BIAS
    e[14] = p.clip.w

    // Draw: neon lit, the rest black, no sky, no shadow-map refresh.
    const background = scene.background
    const autoShadows = gl.shadowMap.autoUpdate
    const clearAlpha = gl.getClearAlpha()
    gl.getClearColor(p.clearColor)
    for (const batch of meshes.values()) {
      if (EMISSIVE.has(batch.name)) continue
      p.swapped.set(batch, { material: batch.material, visible: batch.visible })
      if (SKIPPED.has(batch.name)) batch.visible = false
      else batch.material = p.occluder
    }
    scene.background = null
    gl.shadowMap.autoUpdate = false
    gl.setClearColor(BLACK, 1)
    gl.setRenderTarget(p.target)
    gl.clear()
    gl.render(scene, p.camera)
    p.blur.render(gl, p.target, p.streaks)
    gl.setRenderTarget(null)
    gl.setClearColor(p.clearColor, clearAlpha)
    gl.shadowMap.autoUpdate = autoShadows
    scene.background = background
    for (const [batch, was] of p.swapped) {
      batch.material = was.material
      batch.visible = was.visible
    }
    p.swapped.clear()
  })

  return null
}
