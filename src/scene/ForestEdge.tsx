// Forest edge fading to the horizon (fol-l7d.5, spec Phase 2): three layers
// in height fog (D-046/D-064), all on shared materials so fog and sky share
// one uniform object and no new program compiles.
//
// - Near: true repeats (D-032) as one `InstancedMesh` of canopy blobs on the
//   shared foliage program — never gltf-transform `instance()` into a
//   `BatchedMesh` (D-033). Per-instance phase rides the instance matrix, so
//   shared geometry never sways in lockstep; the weight is the swayModel bake
//   curve over template height.
// - Mid: single-view baked cards (R-010) as one `InstancedMesh` of vertical
//   quads, every card yawed at the town centre, so no vantage frames the band
//   at a new pitch (D-050). Static (`_sway` 0): cards are baked, only the
//   near repeats move.
// - Far: the horizon skirt, one inward-wound ring on the shared ground
//   program, its level top melting into the sky gradient through the shared
//   height fog.
//
// Placement is single-sourced in `content/town/` (hood pads, river course —
// the same files `town.py` bakes from) plus the `forest` section of
// `foliage_params.json` (the same retune point the bake reads). The baked
// town skeleton carries mid cards + skirt with real group slots; this runtime
// layer carries all three until that asset lands, kept apart from the bake
// by radii, never by identity. Forest takes no hover: every vertex carries
// the top group slot, which the append-only pack allocator (D-061) only
// reaches when the town fills the strip — breadth relocates the forest slot
// if that ever happens.
//
// Static once mounted: no `useFrame`, no per-frame invalidation, so
// `?sway=off` rests at zero draws and the shadow pass never sees it
// (`castShadow` stays off — the ±16 m fits end long before the first tree).

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  type BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAX_GROUPS } from '../groupSlots'
import { materials } from '../materials/shared'
import { swayWeight } from '../materials/swayModel'
import {
  forestRing,
  mulberry32,
  readForestConfig,
  readRingInputs,
  TAU,
  type XZ,
} from './forestPlacement'

/** Inert group slot: never pickable (this layer never registers volumes),
 * so its lift/glow state stays zero. See the module note on relocation. */
const FOREST_SLOT = MAX_GROUPS - 1

/** Paints the shared-program channels every town piece carries (see
 * `StressDraws`): the inert group slot, baked AO, no night spill, and the
 * sway weight over template height (or zero for baked cards). The canopy AO
 * darkens toward the dirt line — the runtime half of the clump-core gradient
 * (D-045): undersides sit instead of glowing. */
function paintSharedChannels(
  geometry: BufferGeometry,
  sway: (y: number) => number,
  ao: (y: number) => number,
): void {
  const position = geometry.attributes.position
  if (!position) throw new Error('forest: template has no position')
  const count = position.count
  geometry.setAttribute(
    'groupId',
    new BufferAttribute(new Float32Array(count).fill(FOREST_SLOT), 1),
  )
  const aoValues = new Float32Array(count)
  for (let i = 0; i < count; i += 1) aoValues[i] = ao(position.getY(i))
  geometry.setAttribute('bakedAo', new BufferAttribute(aoValues, 1))
  geometry.setAttribute('bakedNight', new BufferAttribute(new Float32Array(count * 3), 3))
  const weights = new Float32Array(count)
  for (let i = 0; i < count; i += 1) weights[i] = sway(position.getY(i))
  geometry.setAttribute('_sway', new BufferAttribute(weights, 1))
}

/** Underside occlusion for the canopy: full AO at the dirt line, open above. */
function canopyAo(y: number): number {
  const t = Math.min(Math.max((y - 0.5) / 3, 0), 1)
  return 0.62 + 0.38 * t
}

const _dummy = new Object3D()

function buildCanopyTemplate(radii: readonly number[]): BufferGeometry {
  const blobs = radii.map((r, i) => {
    const blob = new IcosahedronGeometry(r, 1)
    blob.scale(1, 0.8, 1)
    // Stacked lobes around a rising core: one soft mass, never one ball.
    const angle = (i / Math.max(radii.length, 1)) * TAU
    blob.translate(Math.cos(angle) * r * 0.45, 2.4 + i * 1.1, Math.sin(angle) * r * 0.45)
    return blob
  })
  const merged = mergeGeometries(blobs)
  for (const blob of blobs) blob.dispose()
  if (!merged) throw new Error('forest: canopy template failed to merge')
  return merged
}

function setInstances(mesh: InstancedMesh, place: (index: number) => void): void {
  for (let i = 0; i < mesh.count; i += 1) {
    _dummy.position.set(0, 0, 0)
    _dummy.rotation.set(0, 0, 0)
    _dummy.scale.set(1, 1, 1)
    place(i)
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  if (!mesh.boundingSphere) throw new Error('forest: instanced layer has no bounds')
}

export function ForestEdge() {
  const invalidate = useThree((state) => state.invalidate)

  const layers = useMemo(() => {
    const config = readForestConfig()
    const inputs = readRingInputs()
    const random = mulberry32(config.seed)

    const foliage = materials.foliage
    const ground = materials.ground
    if (!foliage || !ground) throw new Error('forest: no shared foliage/ground material')

    // Near: one canopy template, instanced around the clearing.
    const canopy = buildCanopyTemplate(config.near.radii)
    canopy.deleteAttribute('uv')
    paintSharedChannels(canopy, (y) => swayWeight(y), canopyAo)
    const nearSpots = forestRing(
      random,
      config,
      inputs,
      config.near.count,
      config.near.r0,
      config.near.r1,
    )
    const near = new InstancedMesh(canopy, foliage.material, nearSpots.length)
    setInstances(near, (i) => {
      const [x, z] = nearSpots[i] as XZ
      _dummy.position.set(x, -config.near.sink, z)
      _dummy.rotation.set(0, random() * TAU, 0)
      const s = 0.8 + random() * 0.5
      _dummy.scale.set(s, 0.9 + random() * 0.4, s)
    })

    // Mid: single-view cards, every one yawed at the town centre (R-010).
    const card = new PlaneGeometry(config.mid.w, config.mid.h)
    card.translate(0, config.mid.h / 2, 0)
    card.deleteAttribute('uv')
    paintSharedChannels(
      card,
      () => 0,
      () => 1,
    )
    const cardSpots = forestRing(
      random,
      config,
      inputs,
      config.mid.count,
      config.mid.r0,
      config.mid.r1,
    )
    const cards = new InstancedMesh(card, foliage.material, cardSpots.length)
    setInstances(cards, (i) => {
      const [x, z] = cardSpots[i] as XZ
      _dummy.position.set(x, config.mid.lift, z)
      _dummy.rotation.set(0, Math.atan2(-x, -z), 0)
      const s = 0.85 + random() * 0.4
      _dummy.scale.set(s, 0.9 + random() * 0.3, 1)
    })

    // Far: the horizon skirt, mirrored to wind inward, level top.
    const skirtHeight = config.far.top + config.far.tuck
    const skirt = new CylinderGeometry(
      config.far.radius,
      config.far.radius,
      skirtHeight,
      config.far.segments,
      1,
      true,
    )
    skirt.translate(0, config.far.top - skirtHeight / 2, 0)
    skirt.scale(-1, 1, 1)
    skirt.deleteAttribute('uv')
    {
      const count = skirt.attributes.position?.count ?? 0
      skirt.setAttribute(
        'groupId',
        new BufferAttribute(new Float32Array(count).fill(FOREST_SLOT), 1),
      )
      skirt.setAttribute('bakedAo', new BufferAttribute(new Float32Array(count).fill(1), 1))
      skirt.setAttribute('bakedNight', new BufferAttribute(new Float32Array(count * 3), 3))
    }
    const skirtMaterial = ground.material
    return { near, cards, skirt, skirtMaterial }
  }, [])

  // One frame for the demand loop; afterwards this layer never invalidates.
  useEffect(() => {
    invalidate()
  }, [invalidate])

  useEffect(
    () => () => {
      layers.near.geometry.dispose()
      layers.cards.geometry.dispose()
      layers.skirt.dispose()
      layers.near.dispose()
      layers.cards.dispose()
    },
    [layers],
  )

  return (
    <>
      <primitive object={layers.near} />
      <primitive object={layers.cards} />
      <mesh geometry={layers.skirt} material={layers.skirtMaterial} />
    </>
  )
}
