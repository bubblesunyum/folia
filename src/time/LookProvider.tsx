import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react'
import { debug } from '../debug'
import { lookAt } from './look'
import { LookContext } from './lookContext'
import { sunAt } from './sun'
import { GOLDEN_HOUR, parseTimeParam } from './timeParam'

const TimePanel = lazy(() => import('./TimePanel'))

const initialHours =
  typeof window === 'undefined'
    ? GOLDEN_HOUR
    : (parseTimeParam(window.location.search) ?? GOLDEN_HOUR)

export function LookProvider({ children }: { children: ReactNode }) {
  const [hours, setHours] = useState(initialHours)
  const value = useMemo(
    () => ({ hours, look: lookAt(hours), sun: sunAt(hours), moon: sunAt(hours + 12) }),
    [hours],
  )
  return (
    <LookContext.Provider value={value}>
      {children}
      {debug.panel && (
        <Suspense fallback={null}>
          <TimePanel initialHours={initialHours} onChange={setHours} />
        </Suspense>
      )}
    </LookContext.Provider>
  )
}
