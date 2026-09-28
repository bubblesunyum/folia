import { describe, expect, it } from 'vitest'
import { parseTimeParam } from './timeParam'

describe('parseTimeParam', () => {
  it('reads HH:MM as hours since midnight', () => {
    expect(parseTimeParam('?time=18:30')).toBe(18.5)
    expect(parseTimeParam('?time=00:00')).toBe(0)
    expect(parseTimeParam('?time=23:59')).toBeCloseTo(23 + 59 / 60)
  })

  it('accepts a single-digit hour', () => {
    expect(parseTimeParam('?time=6:15')).toBe(6.25)
  })

  it('is null when the param is absent', () => {
    expect(parseTimeParam('')).toBeNull()
    expect(parseTimeParam('?hud')).toBeNull()
  })

  it('is null for anything that is not a clock time', () => {
    for (const bad of ['24:00', '12:60', '12', 'noon', '12:5', '-1:00', '12:30:00', '']) {
      expect(parseTimeParam(`?time=${bad}`)).toBeNull()
    }
  })
})
