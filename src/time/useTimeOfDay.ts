import { useControls } from 'leva'
import { GOLDEN_HOUR, parseTimeParam } from './timeParam'

const initialHours = parseTimeParam(window.location.search) ?? GOLDEN_HOUR

/** The current time of day in hours: `?time=` sets where it starts, the panel scrubs it. */
export function useTimeOfDay(): number {
  const { hours } = useControls('time of day', {
    hours: { value: initialHours, min: 0, max: 23.99, step: 0.05 },
  })
  return hours
}
