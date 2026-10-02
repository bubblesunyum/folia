import { addAfterEffect, addEffect, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import Stats from 'stats-gl'
import { renderConfig } from '../debug'
import { pickStats } from '../picking/pickStats'
import { useContextRestores } from '../renderer/contextRestores'
import { type BenchResult, runBurst } from './bench'
import { markFrameSegments } from './frameSegments'
import { createGpuTimer, type FrameTiming, summarize } from './gpuTimer'
import { tallySubDraws } from './subDrawTally'

const READOUT_INTERVAL_MS = 250
// Two seconds at 60 Hz: long enough that the median holds still.
const WINDOW = 120
const SEGMENTS = ['shadow', 'scene', 'post'] as const

/**
 * The perf HUD (D-035): stats-gl for FPS and CPU ms, GPU ms from our own timer
 * query split by pass, and the draw counters renderer.info can't give on its
 * own. GPU ms is the median and p95 over a two-second window, since single
 * frames are too noisy to read. On Metal it is indicative only (D-055); the
 * repeatable budget proxy is the saturated-frame benchmark.
 *
 * The counters accumulate across passes instead of resetting inside each one.
 */
export function PerfHud() {
  // Rebuilt on restore: the timer's queries and extension die with the context.
  return <FrameMeters key={useContextRestores()} />
}

function FrameMeters() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    // stats-gl's own GPU query would collide with ours: only one runs at a time.
    const stats = new Stats({ trackGPU: false, logsPerSecond: 4 })
    void stats.init(gl.domElement)
    stats.dom.classList.add('perf-stats')
    const readout = document.createElement('div')
    readout.className = 'perf-readout'
    document.body.append(stats.dom, readout)

    gl.info.autoReset = false
    const subDraws = tallySubDraws(gl)
    const timer = createGpuTimer(gl.getContext() as WebGL2RenderingContext)
    const unmark = timer ? markFrameSegments(gl, scene, timer) : () => {}
    const frames: FrameTiming[] = []
    // Against navigation start, so the first painted frame always writes the
    // readout: under a demand frame loop there may never be a second one.
    let lastReadout = Number.NEGATIVE_INFINITY

    if (renderConfig.budget) {
      window.foliaBench = (count = 240, warmup?: number) =>
        runBurst(gl.getContext() as WebGL2RenderingContext, count, warmup)
    }

    const stopBefore = addEffect(() => {
      stats.begin()
      gl.info.reset()
      subDraws.reset()
      timer?.mark('pre')
    })
    const stopAfter = addAfterEffect(() => {
      timer?.endFrame()
      stats.end()
      stats.update()
      if (timer) {
        frames.push(...timer.poll())
        frames.splice(0, frames.length - WINDOW)
      }
      // Our own clock: the timestamp R3F passes is in seconds under ?perf=base.
      const now = performance.now()
      if (now - lastReadout < READOUT_INTERVAL_MS) return
      lastReadout = now
      const { calls, triangles } = gl.info.render
      const counts = `calls ${calls} · sub-draws ${subDraws.count} · tris ${formatCount(triangles)}`
      // Hover/click pick cost (fol-hft): the last volume-pick query's ms, read
      // here on the existing 250 ms cadence so picking never schedules a
      // frame of its own (D-056).
      const picking = `pick ${pickStats.lastMs.toFixed(2)} ms · vol ${pickStats.volumes}`
      if (!timer || frames.length === 0) {
        readout.textContent = `${counts}\n${picking}`
        return
      }
      const gpu = summarize(frames.map((frame) => frame.total))
      const split = SEGMENTS.map((label) => {
        const { median } = summarize(frames.map((frame) => frame.segments[label] ?? 0))
        return `${label} ${median.toFixed(2)}`
      })
      readout.textContent = `gpu estimate ${gpu.median.toFixed(2)} ms · p95 ${gpu.p95.toFixed(2)}\n${split.join(' · ')}\n${counts}\n${picking}`
      readout.dataset.json = JSON.stringify({
        gpu,
        frames: frames.length,
        calls,
        subDraws: subDraws.count,
        triangles,
        pickMs: pickStats.lastMs,
        pickPicks: pickStats.picks,
      })
    })

    // The demand loop may have painted its last frame before this effect
    // subscribed; request one more so the readout always gets real counters.
    invalidate()

    return () => {
      stopBefore()
      stopAfter()
      unmark()
      timer?.dispose()
      delete window.foliaBench
      subDraws.restore()
      gl.info.autoReset = true
      stats.dispose()
      stats.dom.remove()
      readout.remove()
    }
  }, [gl, scene, invalidate])

  return null
}

declare global {
  interface Window {
    /** Under `?perf=base`: time `count` frames drawn back to back (see `runBurst`). */
    foliaBench?: (count?: number, warmup?: number) => BenchResult
  }
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
