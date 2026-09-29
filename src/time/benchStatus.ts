// Cross-reconciler status for the look-dev bench (fol-qbb): `WriteBack`
// runs inside the Canvas tree, where rendering a DOM node would crash R3F,
// so it reports here and `<BenchStatus/>` (DOM level, beside the leva panel
// in `App`) renders it.

export type BenchStatusListener = (message: string) => void

const listeners = new Set<BenchStatusListener>()

export function reportBenchStatus(message: string): void {
  for (const listener of [...listeners]) listener(message)
}

/** Hides the readout. */
export function clearBenchStatus(): void {
  reportBenchStatus('')
}

export function onBenchStatus(listener: BenchStatusListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
