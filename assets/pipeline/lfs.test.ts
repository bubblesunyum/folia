import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLfsPointer } from './lfs'

describe('isLfsPointer', () => {
  it('tells a pointer from a real GLB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'folia-lfs-'))
    const pointer = join(dir, 'pointer.glb')
    const glb = join(dir, 'real.glb')
    const empty = join(dir, 'empty.glb')
    await writeFile(
      pointer,
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1614580\n',
    )
    await writeFile(glb, Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]))
    await writeFile(empty, '')
    expect(isLfsPointer(pointer)).toBe(true)
    expect(isLfsPointer(glb)).toBe(false)
    expect(isLfsPointer(empty)).toBe(false)
  })
})
