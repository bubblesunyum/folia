import { type ReactNode, useMemo } from 'react'
import { lookAt } from './look'
import { LookContext } from './lookContext'
import { sunAt } from './sun'
import { useTimeOfDay } from './useTimeOfDay'

export function LookProvider({ children }: { children: ReactNode }) {
  const hours = useTimeOfDay()
  const value = useMemo(
    () => ({ hours, look: lookAt(hours), sun: sunAt(hours), moon: sunAt(hours + 12) }),
    [hours],
  )
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>
}
