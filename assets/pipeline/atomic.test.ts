import { mkdir, mkdtemp, readdir, readFile, utimes } from 'node:fs/promises'
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
})
