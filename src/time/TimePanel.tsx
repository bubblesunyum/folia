import { useControls } from 'leva'
import { useEffect } from 'react'

interface TimePanelProps {
  initialHours: number
  onChange: (hours: number) => void
}

/**
 * The `?panel` time scrubber. Split out so `leva` only loads when the panel
 * is on — the main bundle never sees it.
 */
export default function TimePanel({ initialHours, onChange }: TimePanelProps) {
  const { hours } = useControls('time of day', {
    hours: { value: initialHours, min: 0, max: 23.99, step: 0.05 },
  })
  useEffect(() => {
    onChange(hours)
  }, [hours, onChange])
  return null
}
