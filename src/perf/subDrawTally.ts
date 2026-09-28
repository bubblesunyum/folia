import type { BatchedMesh, WebGLRenderer } from 'three'

type RenderBufferDirect = WebGLRenderer['renderBufferDirect']

export interface SubDrawTally {
  /** Draws issued inside multi-draw batches since the last reset, across every pass. */
  readonly count: number
  reset(): void
  restore(): void
}

/**
 * Counts the draws hidden inside `BatchedMesh` multi-draws. three's
 * `renderer.info` records a whole multi-draw as one call, so the budget needs
 * this second number beside it (D-035). Without `WEBGL_multi_draw`, three
 * falls back to one real call per sub-draw, already in `calls`, so nothing is
 * tallied there.
 */
export function tallySubDraws(gl: WebGLRenderer): SubDrawTally {
  const original = gl.renderBufferDirect
  const multiDraw = gl.extensions.has('WEBGL_multi_draw')
  let count = 0
  gl.renderBufferDirect = function (this: WebGLRenderer, ...args: Parameters<RenderBufferDirect>) {
    const object = args[4] as Partial<BatchedMesh> & { _multiDrawCount?: number }
    if (multiDraw && object.isBatchedMesh) count += object._multiDrawCount ?? 0
    return original.apply(this, args)
  }
  return {
    get count() {
      return count
    },
    reset() {
      count = 0
    },
    restore() {
      gl.renderBufferDirect = original
    },
  }
}
