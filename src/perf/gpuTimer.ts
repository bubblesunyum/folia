/** GPU ms for one frame: the whole of it and each labelled stretch of it. */
export interface FrameTiming {
  total: number
  segments: Record<string, number>
}

export interface GpuTimer {
  /** Ends the running query, if any, and starts timing `label`. */
  mark(label: string): void
  /** Ends the frame's last query and queues the frame for `poll`. */
  endFrame(): void
  /** The frames whose results have come back since the last poll, oldest first. */
  poll(): FrameTiming[]
  dispose(): void
}

interface Pending {
  queries: { label: string; query: WebGLQuery }[]
}

const NS_PER_MS = 1e6

/**
 * Times a frame as back-to-back `TIME_ELAPSED` queries, one per labelled
 * stretch, since WebGL allows only one running at a time. Results arrive a few
 * frames late; a disjoint event (the GPU clocked down or was preempted)
 * invalidates everything in flight, so those frames are dropped, not guessed.
 * Null without `EXT_disjoint_timer_query_webgl2`.
 */
export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!ext) return null
  let current: Pending = { queries: [] }
  let running = false
  const inFlight: Pending[] = []

  const stop = () => {
    if (!running) return
    if (!gl.isContextLost()) gl.endQuery(ext.TIME_ELAPSED_EXT)
    running = false
  }

  // Queries die with a lost context, and deleting them after is an error.
  const discard = (frame: Pending) => {
    if (gl.isContextLost()) return
    for (const { query } of frame.queries) gl.deleteQuery(query)
  }

  return {
    mark(label) {
      stop()
      // Null while the context is lost; the HUD rebuilds the timer on restore.
      const query = gl.createQuery()
      if (!query) return
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      running = true
      current.queries.push({ label, query })
    },
    endFrame() {
      stop()
      if (current.queries.length > 0) inFlight.push(current)
      current = { queries: [] }
    },
    poll() {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const frame of inFlight.splice(0)) discard(frame)
        return []
      }
      const done: FrameTiming[] = []
      for (let frame = inFlight[0]; frame; frame = inFlight[0]) {
        const ready = frame.queries.every(({ query }) =>
          gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        )
        if (!ready) break
        inFlight.shift()
        const timing: FrameTiming = { total: 0, segments: {} }
        for (const { label, query } of frame.queries) {
          const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / NS_PER_MS
          timing.total += ms
          timing.segments[label] = (timing.segments[label] ?? 0) + ms
        }
        discard(frame)
        done.push(timing)
      }
      return done
    },
    dispose() {
      stop()
      discard(current)
      for (const frame of inFlight.splice(0)) discard(frame)
    },
  }
}

/** The median and 95th percentile of a window of samples. */
export function summarize(samples: readonly number[]): { median: number; p95: number } {
  if (samples.length === 0) return { median: 0, p95: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { median: at(0.5), p95: at(0.95) }
}
