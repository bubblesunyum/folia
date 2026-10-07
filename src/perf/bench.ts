import { advance } from '@react-three/fiber'
import { SATURATED_BUDGET_MS } from './renderConfig'

export interface BenchResult {
  frames: number
  /** Wall ms per frame, drawn back to back and synced at the end; includes CPU and GPU work. */
  ms: number
  /** Of that, ms per frame spent in JavaScript issuing the frame. */
  cpuMs: number
}

// Frames drawn untimed first, while the GPU clocks up.
const WARMUP = 60

// Frames per uninterrupted chunk: bounds the main-thread block. Slow
// renderers yield every chunk so input, tests and the demand loop breathe;
// fast ones finish before the first yield matters.
const BURST_CHUNK_FRAMES = 20

// Warmup is clock-up, not measurement: stop warming a renderer that still
// hasn't steadied after this long. Past it the verdict is foregone slow,
// and every further warmup frame is main-thread time nothing can use.
const WARMUP_CAP_MS = 5000

// Counted frames before the slow-certain exit may fire: enough that one GC
// pause or compile straggler can't fake a verdict on its own.
const EARLY_STOP_MIN_FRAMES = 20

// Past this multiple of the gate the verdict can't flip back. Upgrades need
// room under the gate minus spread, downgrades only need over it — at 4x a
// full run could only confirm slowness, never find headroom.
const EARLY_STOP_SLOW_FACTOR = 4

const yieldToMain = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Throughput, not timer queries. On ANGLE's Metal backend a `TIME_ELAPSED`
 * query spans queueing as well as work once frames overlap, and between capped
 * frames Apple GPUs clock down, so neither the HUD's per-frame GPU ms nor a
 * saturated query is repeatable. Drawing `count` frames back to back and
 * waiting on a pixel read gives a repeatable full-frame throughput proxy. It
 * includes CPU submission and readback overhead, so it is not direct GPU time;
 * the slice-exit budget on it is wall ms against SATURATED_BUDGET_MS (D-063).
 *
 * Chunked and slow-certain: each chunk draws back to back with its own pixel
 * sync (the GPU never idles mid-chunk), yields to the main thread between
 * chunks, and stops early once enough counted frames average past any
 * verdict flip. A synchronous 150-frame block 1.5 s after reveal is minutes
 * of frozen input on software rendering and seconds of jank on weak phones;
 * the verdict there was always stay-or-downgrade.
 */
export async function runBurst(
  gl: WebGL2RenderingContext,
  count: number,
  warmup = WARMUP,
): Promise<BenchResult> {
  if (count <= 0) return { frames: 0, ms: 0, cpuMs: 0 }
  const pixel = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  const warmStart = performance.now()
  let warmed = 0
  while (warmed < warmup && performance.now() - warmStart < WARMUP_CAP_MS) {
    const end = Math.min(warmed + BURST_CHUNK_FRAMES, warmup)
    for (; warmed < end; warmed++) advance(performance.now() / 1000)
    await yieldToMain()
  }
  sync()
  let cpu = 0
  let elapsed = 0
  let measured = 0
  while (measured < count) {
    const end = Math.min(measured + BURST_CHUNK_FRAMES, count)
    const start = performance.now()
    for (; measured < end; measured++) {
      const issued = performance.now()
      advance(issued / 1000)
      cpu += performance.now() - issued
    }
    sync()
    elapsed += performance.now() - start
    if (
      measured >= EARLY_STOP_MIN_FRAMES &&
      elapsed / measured > SATURATED_BUDGET_MS * EARLY_STOP_SLOW_FACTOR
    ) {
      break
    }
    if (measured < count) await yieldToMain()
  }
  return { frames: measured, ms: elapsed / measured, cpuMs: cpu / measured }
}
