import { addAfterEffect, addEffect, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import Stats from 'stats-gl'
import { useContextRestores } from '../renderer/contextRestores'
import { tallySubDraws } from './subDrawTally'

const READOUT_INTERVAL_MS = 250

/**
 * The perf HUD (D-035): stats-gl for FPS, CPU ms and GPU ms from the timer
 * query, plus the draw counters renderer.info can't give on its own.
 *
 * GPU time is measured around the whole frame (every pass, the shadow map
 * included) rather than per `render()` call, and the counters accumulate across
 * passes instead of resetting inside each one.
 */
export function PerfHud() {
  // Rebuilt on restore: stats-gl caches the timer-query extension, which a
  // context restore invalidates.
  return <FrameMeters key={useContextRestores()} />
}

function FrameMeters() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const stats = new Stats({ trackGPU: true, logsPerSecond: 4 })
    void stats.init(gl.domElement)
    stats.dom.classList.add('perf-stats')
    const readout = document.createElement('div')
    readout.className = 'perf-readout'
    document.body.append(stats.dom, readout)

    gl.info.autoReset = false
    const subDraws = tallySubDraws(gl)
    let lastReadout = 0

    const stopBefore = addEffect(() => {
      stats.begin()
      gl.info.reset()
      subDraws.reset()
    })
    const stopAfter = addAfterEffect((now) => {
      stats.end()
      stats.update()
      if (now - lastReadout < READOUT_INTERVAL_MS) return
      lastReadout = now
      const { calls, triangles } = gl.info.render
      readout.textContent = `calls ${calls} · sub-draws ${subDraws.count} · tris ${formatCount(triangles)}`
    })

    return () => {
      stopBefore()
      stopAfter()
      subDraws.restore()
      gl.info.autoReset = true
      stats.dispose()
      stats.dom.remove()
      readout.remove()
    }
  }, [gl])

  return null
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
