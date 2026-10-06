import { describe, expect, it } from 'vitest'
import { PRESERVED_QA_PARAMS, parseTimeParam, withQaSearch } from './timeParam'

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

/** Reads one carried param back off a wrapped target. */
function carriedParam(to: string, key: string): string | null {
  const query = to.split('#')[0]?.split('?')[1] ?? ''
  return new URLSearchParams(query).get(key)
}

describe('withQaSearch', () => {
  it('pins the preserved list: a new URL switch must land here', () => {
    expect([...PRESERVED_QA_PARAMS]).toEqual([
      'time',
      'perf',
      'aa',
      'stress',
      'bloom',
      'reflection',
      'sway',
      'fit',
      'shadows',
      'hud',
      'panel',
    ])
  })

  it('carries ?time= onto bare and relative paths, still parsing to the hour', () => {
    for (const to of ['/cortico', '/cortico/platform', 'platform']) {
      const wrapped = withQaSearch(to, '?time=22:00')
      expect(carriedParam(wrapped, 'time')).toBe('22:00')
      expect(parseTimeParam(`?time=${carriedParam(wrapped, 'time') ?? ''}`)).toBe(22)
      expect(wrapped.startsWith(to.split('?')[0] as string)).toBe(true)
    }
  })

  it('carries every render and debug switch, and drops the per-route rest', () => {
    const search = '?time=22:00&perf=base&aa=smaa&stress=10&bloom=off&reflection=off&sway=off'
    const withFit = `${search}&fit=vantage&shadows=static&hud&panel&stop=2&cam=1&foo=bar`
    const wrapped = withQaSearch('/cortico', withFit)
    for (const key of PRESERVED_QA_PARAMS) {
      expect(carriedParam(wrapped, key), key).not.toBeNull()
    }
    expect(carriedParam(wrapped, 'stop')).toBeNull()
    expect(carriedParam(wrapped, 'cam')).toBeNull()
    expect(carriedParam(wrapped, 'foo')).toBeNull()
  })

  it('leaves the target byte-identical when there is nothing to carry', () => {
    expect(withQaSearch('/cortico', '')).toBe('/cortico')
    expect(withQaSearch('/cortico', '?stop=2')).toBe('/cortico')
    expect(withQaSearch('platform', '?foo=bar')).toBe('platform')
  })

  it('never overwrites a param already on the destination', () => {
    expect(carriedParam(withQaSearch('/cortico?time=12:00', '?time=22:00'), 'time')).toBe('12:00')
    expect(carriedParam(withQaSearch('/cortico?perf=air', '?perf=base&time=22:00'), 'perf')).toBe(
      'air',
    )
    expect(carriedParam(withQaSearch('/cortico?perf=air', '?perf=base&time=22:00'), 'time')).toBe(
      '22:00',
    )
  })

  it('carries a malformed ?time= untouched instead of fixing it', () => {
    expect(carriedParam(withQaSearch('/cortico', '?time=noon'), 'time')).toBe('noon')
  })

  it('keeps a trailing hash where it was', () => {
    expect(withQaSearch('/cortico#top', '?time=22:00')).toBe('/cortico?time=22%3A00#top')
  })
})
