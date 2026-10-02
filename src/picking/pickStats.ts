// Last-pick timing for the HUD (fol-hft). Written by `pickSlotFromHit` on the
// picking path, read by PerfHud's 250 ms readout: plain fields, no
// subscription, so picking never schedules a frame of its own (D-056).

export const pickStats = {
  /** Ms of the last volume-pick query (broadphase boxes + candidate tris). */
  lastMs: 0,
  /** Picks recorded since boot. */
  picks: 0,
  /** Ms of the last volume rebuild (the buffer scan, amortized over content changes). */
  lastRebuildMs: 0,
  /** Slots with volumes after the last rebuild, and soup triangles scanned. */
  volumes: 0,
  triangles: 0,
}

/** Records one pick query's milliseconds. */
export function recordPick(ms: number): void {
  pickStats.lastMs = ms
  pickStats.picks += 1
}

/** Records one volume rebuild's cost and size. */
export function recordRebuild(ms: number, volumes: number, triangles: number): void {
  pickStats.lastRebuildMs = ms
  pickStats.volumes = volumes
  pickStats.triangles = triangles
}

/** Zeroes every field: tests reset here. */
export function resetPickStats(): void {
  pickStats.lastMs = 0
  pickStats.picks = 0
  pickStats.lastRebuildMs = 0
  pickStats.volumes = 0
  pickStats.triangles = 0
}
