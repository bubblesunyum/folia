/** The default time of day: golden hour (D-037). */
export const GOLDEN_HOUR = 18.5

/** Hours since midnight from `?time=HH:MM`, or null when it's absent or malformed. */
export function parseTimeParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('time')
  if (raw === null) return null
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw)
  if (!match) return null
  return Number(match[1]) + Number(match[2]) / 60
}

/**
 * QA search params that survive client navigation (fol-76l): the time
 * override plus every URL switch the app reads at boot (`parseRenderConfig`
 * in perf/renderConfig.ts, `debug` in debug.ts). A new switch belongs here
 * too, pinned by the list test below in timeParam.test.ts. Anything else
 * (`?stop=`, a future `?cam=`) stays per-route and never carries over.
 */
export const PRESERVED_QA_PARAMS = [
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
] as const

/**
 * `to` with the QA params from `search` carried over (fol-76l): client-side
 * links and navigates use bare paths, which would drop `?time=` and snap a
 * QA night session back to golden hour on the next load. Params already
 * present on `to` win, so an explicit destination is never overwritten, and
 * anything off the preserved list never carries (fail closed). Pure: route
 * links and the canvas nav wrap their targets through here.
 */
export function withQaSearch(to: string, search: string): string {
  const carried = new URLSearchParams(search)
  const keep = new URLSearchParams()
  for (const key of PRESERVED_QA_PARAMS) {
    const value = carried.get(key)
    if (value !== null) keep.set(key, value)
  }
  if ([...keep].length === 0) return to
  const hashIndex = to.indexOf('#')
  const hash = hashIndex === -1 ? '' : to.slice(hashIndex)
  const withoutHash = hashIndex === -1 ? to : to.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  const base = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex)
  const merged = new URLSearchParams(queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1))
  for (const [key, value] of keep) {
    if (!merged.has(key)) merged.set(key, value)
  }
  const query = merged.toString()
  return `${base}${query === '' ? '' : `?${query}`}${hash}`
}
