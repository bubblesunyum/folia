import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  type BatchedMesh,
  Box3,
  Color,
  Frustum,
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
import { versionForMeshes } from '../assets/townVersion'
import { renderConfig } from '../debug'
import { materials } from '../materials/shared'
import { water } from '../materials/water'
import { useContextRestores } from '../renderer/contextRestores'
import { createStreakBlur } from '../renderer/streakBlur'
import { useLook } from '../time/lookContext'
import {
  createReflectionScopeScratch,
  forEachReflectionInstance,
  withDayReflectionScope,
} from './reflectionScope'
import { useTownBatches } from './TownBatches'
import {
  classifyWaterBatch,
  DAY_REFLECTION_CUTOFF,
  NIGHT_REFLECTION_CUTOFF,
  pondTouchesFrustum,
  shouldSkipReflection,
} from './waterReflectionSkip'

const BLACK = new Color(0, 0, 0)
/** Keeps the oblique near plane just under the water, so the pool's own edge doesn't clip. */
const CLIP_BIAS = 0.003
// Maps clip space [-1, 1] to texture space [0, 1].
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

/**
 * The water's quarter-res mirrored pass (D-039): at night the neon draws lit
 * over black occluders; by day the opaque batches draw in one cheap lit color
 * (fol-snu.2), so the pond mirrors warm architecture masses instead of flat
 * teal. Drawn from the camera mirrored in the pool's plane, with an oblique
 * near plane cutting away everything under it, then blurred into vertical
 * streaks. The water program reads it through `uReflectionMatrix`. Runs
 * inside the frame, before the composer, so it costs nothing while idle (D-056).
 *
 * The pass sits frames out (fol-4zo): `?reflection=off`, neither night nor
 * day weight up, no water batch in the registry, or every pond off-frustum.
 * Skipped frames do no GL work and ask for no invalidate, and the water falls
 * back to env and Fresnel via `uReflectionStrength` 0.
 */
export function WaterReflection() {
  const gl = useThree((state) => state.gl)
  const { meshes } = useTownBatches()
  const { look, sun, palette: pal } = useLook()
  const night = look.night
  const day = sun.daylight
  // Recreated on restore (fol-l7d.13): the targets hold GL handles from the
  // lost context, so the pass rebuilds on the restores count like the
  // composer does; the previous targets are disposed underneath.
  const restores = useContextRestores()
  // biome-ignore lint/correctness/useExhaustiveDependencies: restores is the rebuild key
  const pass = useMemo(() => {
    return {
      target: new WebGLRenderTarget(1, 1, { type: HalfFloatType }),
      streaks: new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }),
      blur: createStreakBlur(),
      camera: new PerspectiveCamera(),
      occluder: new MeshBasicMaterial({ color: BLACK }),
      size: new Vector2(),
      clearColor: new Color(),
      // Scratch for the day occluder (fol-snu.2): the sun tint, so the
      // per-draw multiply below allocates nothing.
      daySun: new Color(),
      box: new Box3(),
      frustum: new Frustum(),
      viewProj: new Matrix4(),
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
      ponds: [] as Box3[],
      pondCount: 0,
      reflectionScope: createReflectionScopeScratch(),
      // Pond discovery cache (fol-kes.14): the ponds' live bounds move only
      // when town content does, so steady frames reuse them with no
      // per-instance scan. Undefined until the first discovery below.
      pondVersion: undefined as number | undefined,
    }
  }, [restores])

  // The mirrored pass's roles by material identity, never by batch name: a
  // renamed batch, a second water batch on the same shared material, or
  // batches nested in groups all land by what they draw.
  const roles = useMemo(
    () => ({
      waterMaterial: materials.water?.material ?? null,
      emissiveMaterials: new Set<Material>(materials.neon ? [materials.neon.material] : []),
      hiddenMaterials: new Set<Material>(
        [materials.water?.material, materials.neonGlow?.material].filter(
          (m): m is Material => m != null,
        ),
      ),
    }),
    [],
  )

  useEffect(() => {
    water.uniforms.uReflection.value = pass.streaks.texture
    // 0 until a mirrored draw lands: every skip path leaves env + Fresnel only.
    water.uniforms.uReflectionStrength.value = 0
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
    // Cheap gates first: no discovery, no bounds, no GL when the pass is
    // off by flag or when neither weight is up. The frustum/discovery work
    // below only runs when a mirrored draw is actually possible.
    if (
      !renderConfig.reflection ||
      (!(night > NIGHT_REFLECTION_CUTOFF) && !(day > DAY_REFLECTION_CUTOFF))
    ) {
      water.uniforms.uReflectionStrength.value = 0
      return
    }
    const p = pass

    // Pass one derives each visible pond's live world bounds. A town-wide
    // batch box cannot define a useful reflection neighborhood because it
    // includes every instance in that batch. Cached on the registry version
    // (fol-kes.14): steady frames reuse the ponds with no per-instance scan.
    const contentVersion = versionForMeshes(meshes)
    if (contentVersion === undefined || p.pondVersion !== contentVersion) {
      p.box.makeEmpty()
      p.pondCount = 0
      for (const batch of meshes.values()) {
        if (classifyWaterBatch(batch.material, roles) !== 'pool') continue
        if (!batch.visible) continue
        forEachReflectionInstance(batch, p.reflectionScope, (_id, visible, bounds) => {
          if (!visible || !bounds) return
          const index = p.pondCount
          p.pondCount += 1
          const pond = p.ponds[index]
          if (pond) pond.copy(bounds)
          else p.ponds.push(bounds.clone())
          p.box.union(bounds)
        })
      }
      p.pondVersion = contentVersion
    }

    p.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    p.frustum.setFromProjectionMatrix(p.viewProj)
    // Empty bounds read as off-frustum; the predicate already skips those,
    // and the explicit check narrows for the mirror below.
    const pools = p.pondCount
    const inFrustum = pools > 0 && pondTouchesFrustum(p.frustum, p.box)
    if (
      pools === 0 ||
      shouldSkipReflection({
        enabled: renderConfig.reflection,
        night,
        day,
        hasWater: pools > 0,
        pondInFrustum: inFrustum,
      })
    ) {
      water.uniforms.uReflectionStrength.value = 0
      return
    }
    const bounds = p.box

    // Quarter the pixels of the drawing buffer: half each side.
    gl.getDrawingBufferSize(p.size)
    const width = Math.max(1, Math.floor(p.size.x / 2))
    const height = Math.max(1, Math.floor(p.size.y / 2))
    if (p.target.width !== width || p.target.height !== height) {
      p.target.setSize(width, height)
      p.streaks.setSize(width, height)
    }

    // The pool is flat; its plane is the top of the ponds' bounds.
    p.point.set(0, bounds.max.y, 0)
    p.plane.setFromNormalAndCoplanarPoint(p.normal, p.point)

    // Mirror the camera's position, forward point and up in the plane.
    camera.getWorldPosition(p.eye)
    if (p.plane.distanceToPoint(p.eye) <= 0) {
      water.uniforms.uReflectionStrength.value = 0
      return
    }
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

    // Draw: neon lit, the rest occluding, no sky, no shadow-map refresh.
    // Emissive batches are deliberately untouched here: they draw with
    // their own material so the neon stays lit in the mirror. By day the
    // occluders wear the cheap lit color (fol-snu.2) so the pond mirrors warm
    // masses; at night they stay black around the neon streaks.
    const nightPass = night > NIGHT_REFLECTION_CUTOFF
    // The day occluders' cheap lit color (fol-snu.2): cream albedo under the
    // sun's color, with no lights and no shadow — one flat warm the pond can
    // mirror as architecture masses. Derived per-draw from the live palette,
    // like every other palette uniform `applyLook` writes, so the look-dev
    // draft recolors the mirror too; never frozen from the import-time palette.
    if (nightPass) p.occluder.color.copy(BLACK)
    else p.occluder.color.set(pal.cream).multiply(p.daySun.set(pal.sunlight))
    const background = scene.background
    const autoShadows = gl.shadowMap.autoUpdate
    const clearAlpha = gl.getClearAlpha()
    const previousTarget = gl.getRenderTarget()
    gl.getClearColor(p.clearColor)
    water.uniforms.uReflectionStrength.value = 0
    const hide = (batch: BatchedMesh) => {
      p.swapped.set(batch, { material: batch.material, visible: batch.visible })
      batch.visible = false
    }
    try {
      // Pass two, draw path only: swap materials by role, re-classifying in
      // place rather than reusing arrays. Emissive batches stay untouched.
      for (const batch of meshes.values()) {
        const role = classifyWaterBatch(batch.material, roles)
        if (role === 'emissive') continue
        if (role === 'pool' || role === 'hidden') hide(batch)
        else {
          p.swapped.set(batch, { material: batch.material, visible: batch.visible })
          batch.material = p.occluder
        }
      }
      scene.background = null
      gl.shadowMap.autoUpdate = false
      gl.setClearColor(BLACK, 1)

      const draw = () => {
        gl.setRenderTarget(p.target)
        gl.clear()
        gl.render(scene, p.camera)
        p.blur.render(gl, p.target, p.streaks)
      }
      if (nightPass) draw()
      else
        withDayReflectionScope(
          meshes.values(),
          p.ponds,
          6,
          p.reflectionScope,
          draw,
          p.pondCount,
          contentVersion,
        )
    } finally {
      gl.setRenderTarget(previousTarget)
      gl.setClearColor(p.clearColor, clearAlpha)
      gl.shadowMap.autoUpdate = autoShadows
      scene.background = background
      for (const [batch, was] of p.swapped) {
        batch.material = was.material
        batch.visible = was.visible
      }
      p.swapped.clear()
    }
    water.uniforms.uReflectionStrength.value = 1
  })

  return null
}
