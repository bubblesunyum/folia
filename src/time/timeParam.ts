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
