// Cross-process safe file publishing for the asset pipeline (fol-4rq).
//
// The dev plugin and a CLI asset build can run at once: both shell out to
// `build.ts`, which used to share one `.cache/blender/<asset>.raw.glb` path,
// overwrite `public/assets/<asset>.glb` in place, and read-modify-write
// `assets/manifest.json` with no coordination. That gives three races: raw
// clobbering, torn GLBs served mid-write, and lost manifest updates.
//
// The raw clobber is fixed at the call site with a per-invocation tmp path.
// This module covers the rest: `writeFileAtomic` publishes through a tmp file
// in the same directory plus rename (atomic on POSIX, so readers see the old
// or the new file, never half of one), and `withFileLock` serializes the
// manifest read-modify-write across processes with a mkdir lock.

import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Writes `data` to `path` atomically via a tmp file plus rename. */
export async function writeFileAtomic(
  path: string,
  data: string | NodeJS.ArrayBufferView,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(
    dirname(path),
    `.${process.pid}.${randomBytes(4).toString('hex')}.${Date.now()}.tmp`,
  )
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true })
  }
}

export interface LockOptions {
  /** How long to wait for the lock before throwing. Default 30s. */
  timeoutMs?: number
  /** A lock older than this is treated as crashed-holder garbage. Default 30s. */
  staleMs?: number
  /** Delay between acquisition attempts. Default 50ms. */
  retryMs?: number
}

/**
 * Runs `fn` while holding an exclusive cross-process lock at `lockDir`.
 * The lock is a directory: `mkdir` either creates it (acquired) or fails
 * with EEXIST (held). Stale locks from crashed holders are removed.
 */
export async function withFileLock<T>(
  lockDir: string,
  fn: () => T | Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const { timeoutMs = 30_000, staleMs = 30_000, retryMs = 50 } = opts
  await mkdir(dirname(lockDir), { recursive: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const mtime = (await stat(lockDir)).mtimeMs
        if (Date.now() - mtime > staleMs) await rm(lockDir, { recursive: true, force: true })
      } catch {
        // Raced with the holder releasing; retry immediately.
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lockDir}`)
      await sleep(retryMs)
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}
