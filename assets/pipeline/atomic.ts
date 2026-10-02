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
//
// Size note (fol-alg): weighed against proper-lockfile and a
// heartbeat-free mkdir+rm scheme; kept hand-rolled. A dependency still
// needs our own heartbeat wrapper to keep the slow-holder tests green,
// so the net saving is small for a new dep plus lockfile churn. A
// heartbeat-free scheme either stalls crash recovery on a generous
// staleMs or risks evicting a slow pack — and plain check-then-rm lets a
// fresh holder landing between the age check and the rm lose its lock
// silently. Each mechanism maps to a test in atomic.test.ts: heartbeat →
// slow/live-holder cases, rename-to-break → racing-waiters case, token +
// owned release → foreign-lock case. Shrink any of them and a test names
// what broke.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
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
  /** A lock whose heartbeat is older than this is treated as crashed-holder garbage. Default 30s. */
  staleMs?: number
  /** Delay between acquisition attempts. Default 50ms. */
  retryMs?: number
  /** How often the holder refreshes the heartbeat while holding. Default staleMs/5 clamped to 50ms–2s. */
  heartbeatMs?: number
}

/** Heartbeat file inside the lock dir: the holder touches it while holding. */
function heartbeatPath(lockDir: string): string {
  return join(lockDir, 'heartbeat')
}

/**
 * The token identifying one acquisition: pid plus randomness, so two
 * holders in the same process (or two processes sharing a pid namespace)
 * never compare equal. Written to the heartbeat on acquire; every delete
 * below only removes a dir whose token still matches what was observed,
 * so a waiter can never break a new holder's live lock.
 */
function newToken(): string {
  return `${process.pid}.${randomBytes(8).toString('hex')}.${Date.now()}`
}

async function readToken(lockDir: string): Promise<string | null> {
  try {
    return await readFile(heartbeatPath(lockDir), 'utf8')
  } catch {
    return null
  }
}

/** Age of the lock: heartbeat mtime when present, else the lock dir mtime
 * (covers crashed holders from before the heartbeat existed). */
async function lockAgeMs(lockDir: string): Promise<number> {
  const now = Date.now()
  try {
    const mtime = (await stat(heartbeatPath(lockDir))).mtimeMs
    return now - mtime
  } catch {
    const mtime = (await stat(lockDir)).mtimeMs
    return now - mtime
  }
}

/**
 * Runs `fn` while holding an exclusive cross-process lock at `lockDir`.
 * The lock is a directory: `mkdir` either creates it (acquired) or fails
 * with EEXIST (held). The holder writes a unique token to a heartbeat
 * file inside the lock dir and refreshes it while holding, so a pack
 * slower than `staleMs` keeps the lock; a waiter breaks the lock only
 * when the heartbeat is dead past `staleMs` (crashed holder) *and* the
 * token is unchanged since it was observed, then moves the dir aside
 * with an atomic rename — so two waiters racing a stale lock can't
 * both enter: exactly one wins the move, the other retries against
 * the fresh lock. Fail closed: an
 * unreadable lock is treated as live, never stale, and release only
 * removes a dir that still carries our token, never a thief's.
 */
export async function withFileLock<T>(
  lockDir: string,
  fn: () => T | Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const { timeoutMs = 30_000, staleMs = 30_000, retryMs = 50 } = opts
  const heartbeatMs = opts.heartbeatMs ?? Math.min(2000, Math.max(50, Math.floor(staleMs / 5)))
  await mkdir(dirname(lockDir), { recursive: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        if ((await lockAgeMs(lockDir)) > staleMs) {
          // Re-read the token: break only what was observed stale. A
          // changed token means another waiter already broke and
          // re-acquired (or a pre-heartbeat dir gained one) — retry.
          const before = await readToken(lockDir)
          if ((await lockAgeMs(lockDir)) > staleMs && (await readToken(lockDir)) === before) {
            // A null token both times is a pre-heartbeat crashed dir:
            // still breakable (nothing newer can exist to protect), and
            // mkdir below serializes racers.
            //
            // Break via rename, not rm: exactly one racing waiter wins
            // the move, so two processes can never both hold the lock.
            // Then verify the moved dir is what was checked stale — a
            // fresh token or age means a new holder landed between the
            // check and the move, so put it back and retry rather than
            // break live. rename preserves mtimes, so the age still
            // describes the holder, not the move.
            const staleCopy = `${lockDir}.stale.${Date.now()}.${process.pid}.${randomBytes(4).toString('hex')}`
            let moved = false
            try {
              await rename(lockDir, staleCopy)
              moved = true
            } catch {
              // Lost the race (another waiter broke it first, or the
              // holder released): fall through to the deadline check and
              // retry against whatever is there now.
            }
            if (moved) {
              const movedToken = await readToken(staleCopy)
              if (movedToken !== before || (await lockAgeMs(staleCopy)) <= staleMs) {
                try {
                  await rename(staleCopy, lockDir)
                } catch {
                  // The name is taken again (a new holder acquired while
                  // the dir was moved aside). Their lock is fresh, so the
                  // copy is left orphaned rather than deleted: never
                  // remove live state. Orphans only arise in this
                  // microsecond corner and block nothing (different name).
                }
              } else {
                await rm(staleCopy, { recursive: true, force: true })
              }
            }
          }
        }
      } catch {
        // Raced with the holder releasing, or the lock is unreadable:
        // treat as live and retry rather than breaking a live holder.
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lockDir}`)
      await sleep(retryMs)
    }
  }
  // Heartbeat: the unique token plus touches, so waiters see a live holder
  // even when the hold outlasts staleMs. Started only after acquiring.
  const token = newToken()
  const beat = heartbeatPath(lockDir)
  let heartbeatWritten = false
  try {
    await writeFile(beat, token)
    heartbeatWritten = true
  } catch {
    // Best effort: the lock itself is still held via the dir; a missing
    // heartbeat just falls back to dir-mtime staleness for waiters.
  }
  const pulse = setInterval(() => {
    const now = new Date()
    // Touch the heartbeat; also the dir for readers on old versions.
    // Fire-and-forget with a catch: a failed touch must never throw
    // out of the interval and must never release a held lock.
    utimes(beat, now, now).catch(() => {})
    utimes(lockDir, now, now).catch(() => {})
  }, heartbeatMs)
  if (typeof pulse.unref === 'function') pulse.unref()
  try {
    return await fn()
  } finally {
    clearInterval(pulse)
    // Only release what we still own: a stalled holder that got stolen
    // from must not delete the thief's live lock. Without a heartbeat of
    // our own (write failed above) fall back to the plain release.
    if (!heartbeatWritten || (await readToken(lockDir)) === token) {
      await rm(lockDir, { recursive: true, force: true })
    }
  }
}
