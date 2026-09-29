import type { Scene, WebGLRenderer } from 'three'
import type { GpuTimer } from './gpuTimer'

/**
 * Marks the stretches of a frame on the timer: `pre` until the sun's shadow
 * map, `shadow` while it draws, `scene` for the main pass and `post` for the
 * composer's passes after it. Returns the undo.
 */
export function markFrameSegments(gl: WebGLRenderer, scene: Scene, timer: GpuTimer): () => void {
  const render = gl.render
  const renderShadows = gl.shadowMap.render
  gl.shadowMap.render = function (lights, ...rest) {
    // Called for every render; only the pass with a shadow-casting light draws.
    if (lights.length === 0) return renderShadows.call(this, lights, ...rest)
    timer.mark('shadow')
    renderShadows.call(this, lights, ...rest)
    timer.mark('scene')
  }
  gl.render = function (target, camera) {
    if (target === scene) timer.mark('scene')
    render.call(this, target, camera)
    if (target === scene) timer.mark('post')
  }
  return () => {
    gl.render = render
    gl.shadowMap.render = renderShadows
  }
}
