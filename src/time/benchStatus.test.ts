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

  it('fans out repeats: identical consecutive reports notify twice, not once', () => {
    const seen: string[] = []
    const off = onBenchStatus((message) => seen.push(message))
    reportBenchStatus('same failure')
    reportBenchStatus('same failure')
    off()
    expect(seen).toEqual(['same failure', 'same failure'])
  })
})
