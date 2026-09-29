import { useEffect, useState } from 'react'
import { onBenchStatus } from './benchStatus'

/** The bench's save readout, at DOM level beside the leva panel. */
export function BenchStatusReadout() {
  const [status, setStatus] = useState('')
  useEffect(() => onBenchStatus(setStatus), [])
  if (!status) return null
  return (
    <div className="bench-status" role="status">
      {status}
    </div>
  )
}
