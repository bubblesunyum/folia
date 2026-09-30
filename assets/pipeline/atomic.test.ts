import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withFileLock, writeFileAtomic } from './atomic'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'folia-atomic-'))
}

describe('writeFileAtomic', () => {
  it('round-trips content and leaves no tmp files behind', async () => {
    const dir = await sandbox()
    const path = join(dir, 'manifest.json')
    await writeFileAtomic(path, '{"a":1}\n')
    expect(await readFile(path, 'utf8')).toBe('{"a":1}\n')
    await writeFileAtomic(path, '{"a":2}\n')
    expect(await readFile(path, 'utf8')).toBe('{"a":2}\n')
    expect(await readdir(dir)).toEqual(['manifest.json'])
  })
})

describe('withFileLock', () => {
  it('serializes concurrent holders', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    let active = 0
    let maxActive = 0
    let count = 0
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withFileLock(lock, async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await sleep(10)
          count += 1
          active -= 1
        }),
      ),
    )
    expect(count).toBe(8)
    expect(maxActive).toBe(1)
  })

  it('releases the lock when the body throws', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    await expect(
      withFileLock(lock, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    let ran = false
    await withFileLock(lock, () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('recovers a stale lock from a crashed holder', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    await mkdir(lock)
    const ancient = new Date(Date.now() - 60_000)
    await utimes(lock, ancient, ancient)
    let ran = false
    await withFileLock(
      lock,
      () => {
        ran = true
      },
      { staleMs: 1_000, timeoutMs: 5_000 },
    )
    expect(ran).toBe(true)
  })

  it('recovers a dead heartbeat: crashed holder that had been beating', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    await mkdir(lock)
    await writeFile(join(lock, 'heartbeat'), '99999')
    const ancient = new Date(Date.now() - 60_000)
    await utimes(join(lock, 'heartbeat'), ancient, ancient)
    await utimes(lock, ancient, ancient)
    let ran = false
    await withFileLock(
      lock,
      () => {
        ran = true
      },
      { staleMs: 1_000, timeoutMs: 5_000 },
    )
    expect(ran).toBe(true)
  })

  it('slow holder keeps the lock past staleMs while its heartbeat beats', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    const opts = { staleMs: 200, heartbeatMs: 40, timeoutMs: 8_000, retryMs: 10 }
    let holderReleased = 0
    let waiterAcquired = 0
    let active = 0
    let maxActive = 0
    const holder = withFileLock(
      lock,
      async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        // Hold ~4x staleMs: without a heartbeat a waiter would reclaim this.
        await sleep(800)
        active -= 1
        holderReleased = Date.now()
        return 'holder-done'
      },
      opts,
    )
    await sleep(20)
    const waiter = withFileLock(
      lock,
      async () => {
        waiterAcquired = Date.now()
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(10)
        active -= 1
      },
      opts,
    )
    const [result] = await Promise.all([holder, waiter])
    expect(result).toBe('holder-done')
    expect(maxActive).toBe(1)
    expect(waiterAcquired).toBeGreaterThanOrEqual(holderReleased)
  })

  it('waiter with a live holder waits rather than breaking the lock', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    const opts = { staleMs: 150, heartbeatMs: 30, timeoutMs: 8_000, retryMs: 10 }
    // The holder does several sequential steps; eviction mid-hold would
    // interleave the waiter and show up as overlap or missing steps.
    const steps: number[] = []
    let holderEnd = 0
    let waiterStart = Number.POSITIVE_INFINITY
    const holder = withFileLock(
      lock,
      async () => {
        for (let i = 0; i < 8; i++) {
          steps.push(i)
          await sleep(75)
        }
        holderEnd = Date.now()
      },
      opts,
    )
    await sleep(20)
    const waiter = withFileLock(
      lock,
      () => {
        waiterStart = Date.now()
      },
      opts,
    )
    await Promise.all([holder, waiter])
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(waiterStart).toBeGreaterThanOrEqual(holderEnd)
  })

  it('refreshes the heartbeat while holding', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    await withFileLock(
      lock,
      async () => {
        const beat = join(lock, 'heartbeat')
        const first = (await stat(beat)).mtimeMs
        await sleep(150)
        const second = (await stat(beat)).mtimeMs
        expect(second).toBeGreaterThan(first)
      },
      { staleMs: 1_000, heartbeatMs: 30, timeoutMs: 5_000 },
    )
  })

  it('racing waiters on one stale lock serialize: only one breaks it', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    // A crashed holder's stale lock, heartbeat-era token included.
    await mkdir(lock)
    await writeFile(join(lock, 'heartbeat'), 'dead-holder-token')
    const ancient = new Date(Date.now() - 60_000)
    await utimes(join(lock, 'heartbeat'), ancient, ancient)
    await utimes(lock, ancient, ancient)
    const opts = { staleMs: 100, heartbeatMs: 20, timeoutMs: 10_000, retryMs: 5 }
    let active = 0
    let maxActive = 0
    let count = 0
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withFileLock(
          lock,
          async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await sleep(20)
            count += 1
            active -= 1
          },
          opts,
        ),
      ),
    )
    expect(count).toBe(6)
    expect(maxActive).toBe(1)
  })

  it('release never deletes a lock it no longer owns', async () => {
    const dir = await sandbox()
    const lock = join(dir, 'test.lock')
    await withFileLock(
      lock,
      async () => {
        // Simulate a stale-version breaker stealing the dir mid-hold:
        // remove ours, install a foreign live lock in its place.
        await rm(lock, { recursive: true, force: true })
        await mkdir(lock)
        await writeFile(join(lock, 'heartbeat'), 'foreign-live-token')
      },
      { staleMs: 1_000, heartbeatMs: 30, timeoutMs: 5_000 },
    )
    // Our release must have left the foreign lock alone.
    expect(await readFile(join(lock, 'heartbeat'), 'utf8')).toBe('foreign-live-token')
  })
})
