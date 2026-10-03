// The material composer (R-005): shared three materials with features
// injected through onBeforeCompile, so the town runs on a handful of programs
// instead of one per surface. A feature names the chunks it edits; a missing
// chunk throws at compile rather than silently rendering without the feature.

import {
  type IUniform,
  type Material,
  MeshDepthMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three'

/** Code placed around, or instead of, one `#include <chunk>`. */
export interface ChunkEdit {
  before?: string
  after?: string
  instead?: string
}

export interface Stage {
  /** Declarations, placed before `void main()`. */
  header?: string
  chunks?: Readonly<Record<string, ChunkEdit>>
}

export interface Feature {
  /** Part of the program cache key; two features with one key must emit the same code. */
  key: string
  /**
   * Keys that must be composed in the same program: a consumer that reads
   * another feature's varying declares nothing itself (one declaration per
   * program), so composing it alone would compile to an undeclared
   * identifier. `install` throws on a missing requirement instead.
   */
  requires?: readonly string[]
  /** Shared by reference: every material with the feature reads the same objects. */
  uniforms?: Readonly<Record<string, IUniform>>
  vertex?: Stage
  fragment?: Stage
  /** Vertex edits the shadow-depth material needs too (anything that moves vertices). */
  depthVertex?: Stage
}

/**
 * `source` with `stage`'s header and chunk edits applied; throws on a missing
 * chunk. Edits nest: a later feature's code sits closer to the chunk than an
 * earlier one's, and after an `instead` the chunk is gone for later features.
 */
export function inject(source: string, stage: Stage | undefined, where: string): string {
  if (!stage) return source
  let out = source
  for (const [chunk, edit] of Object.entries(stage.chunks ?? {})) {
    const include = `#include <${chunk}>`
    if (!out.includes(include)) throw new Error(`${where} has no ${include} to edit`)
    const body = edit.instead ?? include
    out = out.replace(include, [edit.before, body, edit.after].filter(Boolean).join('\n'))
  }
  if (stage.header) out = out.replace('void main() {', `${stage.header}\nvoid main() {`)
  return out
}

function install<M extends Material>(
  material: M,
  features: readonly Feature[],
  stageOf: (f: Feature) => { vertex?: Stage; fragment?: Stage },
): M {
  const key = features.map((f) => f.key).join('+')
  const have = new Set(features.map((f) => f.key))
  for (const feature of features) {
    for (const need of feature.requires ?? []) {
      if (!have.has(need)) throw new Error(`${feature.key} requires ${need} in the same program`)
    }
  }
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    for (const feature of features) {
      Object.assign(shader.uniforms, feature.uniforms)
      const { vertex, fragment } = stageOf(feature)
      shader.vertexShader = inject(shader.vertexShader, vertex, `${material.type} vertex`)
      shader.fragmentShader = inject(shader.fragmentShader, fragment, `${material.type} fragment`)
    }
  }
  // The default key is onBeforeCompile's source, identical for every composition.
  material.customProgramCacheKey = () => key
  material.needsUpdate = true
  return material
}

/** Installs `features` on `material`, in order. */
export function composeMaterial<M extends Material>(material: M, features: readonly Feature[]): M {
  return install(material, features, (f) => ({ vertex: f.vertex, fragment: f.fragment }))
}

/** The shadow-depth material for a composed material, carrying its vertex motion. */
export function composeDepthMaterial(features: readonly Feature[]): MeshDepthMaterial {
  const moving = features.filter((f) => f.depthVertex)
  return install(new MeshDepthMaterial(), moving, (f) => ({ vertex: f.depthVertex }))
}
