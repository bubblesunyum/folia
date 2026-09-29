import { describe, expect, it } from 'vitest'
import { summarize } from './gpuTimer'

describe('summarize', () => {
  it('reads the median and 95th percentile', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(summarize(samples)).toEqual({ median: 51, p95: 96 })
  })

  it('does not reorder the caller’s samples', () => {
    const samples = [3, 1, 2]
    summarize(samples)
    expect(samples).toEqual([3, 1, 2])
  })

  it('is zero with no samples', () => {
    expect(summarize([])).toEqual({ median: 0, p95: 0 })
  })
})
