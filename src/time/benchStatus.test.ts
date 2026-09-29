import { describe, expect, it } from 'vitest'
import { onBenchStatus, reportBenchStatus } from './benchStatus'

describe('bench status', () => {
  it('fans out to listeners until they unsubscribe', () => {
    const seen: string[][] = [[], []]
    const off0 = onBenchStatus((message) => seen[0]?.push(message))
    const off1 = onBenchStatus((message) => seen[1]?.push(message))
    reportBenchStatus('a')
    off0()
    reportBenchStatus('b')
    off1()
    reportBenchStatus('c')
    expect(seen).toEqual([['a'], ['a', 'b']])
  })
})
