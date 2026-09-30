// Git LFS pointer detection (D-062). A clone without git-lfs checks out each
// GLB as a ~130-byte text pointer; GLTFLoader then fails with a parse error
// that names nothing useful, so `--check` catches it first and says what to run.

import { closeSync, openSync, readSync } from 'node:fs'

const POINTER_HEADER = 'version https://git-lfs.github.com/spec/'

/** True when `path` is an LFS pointer rather than the file it stands for. */
export function isLfsPointer(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(POINTER_HEADER.length)
    const read = readSync(fd, head, 0, head.length, 0)
    return head.toString('utf8', 0, read) === POINTER_HEADER
  } finally {
    closeSync(fd)
  }
}
