import { advance } from '@react-three/fiber'

export interface BenchResult {
  frames: number
  /** Wall ms per frame, drawn back to back and synced at the end; includes CPU and GPU work. */
  ms: number
  /** Of that, ms per frame spent in JavaScript issuing the frame. */
  cpuMs: number
}

// Frames drawn untimed first, while the GPU clocks up.
const WARMUP = 60

/**
 * Throughput, not timer queries. On ANGLE's Metal backend a `TIME_ELAPSED`
 * query spans queueing as well as work once frames overlap, and between capped
 * frames Apple GPUs clock down, so neither the HUD's per-frame GPU ms nor a
 * saturated query is repeatable. Drawing `count` frames back to back and
 * waiting on a pixel read gives a repeatable full-frame throughput proxy. It
 * includes CPU submission and readback overhead, so it is not direct GPU time
 * and does not by itself verify D-035's GPU budget (D-055).
 */
export function runBurst(gl: WebGL2RenderingContext, count: number, warmup = WARMUP): BenchResult {
  const pixel = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  for (let i = 0; i < warmup; i++) advance(performance.now() / 1000)
  sync()
  let cpu = 0
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    const issued = performance.now()
    advance(issued / 1000)
    cpu += performance.now() - issued
  }
  sync()
  const elapsed = performance.now() - start
  return { frames: count, ms: elapsed / count, cpuMs: cpu / count }
}
