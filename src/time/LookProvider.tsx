import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react'
import { debug } from '../debug'
import { palette } from '../palette'
import { initialDraft, type LookDraft, lookAt, resolveDraft } from './look'
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
  // The panel's working copy; null until the first tweak, so production and
  // the untouched dev scene resolve straight from the files.
  const [draft, setDraft] = useState<LookDraft | null>(null)
  const files = useMemo(() => initialDraft(), [])
  const value = useMemo(() => {
    const resolved = draft ? resolveDraft(draft, hours) : lookAt(hours)
    return {
      hours,
      look: resolved,
      sun: sunAt(hours),
      moon: sunAt(hours + 12),
      palette: draft?.palette ?? palette,
    }
  }, [hours, draft])
  return (
    <LookContext.Provider value={value}>
      {children}
      {debug.panel && (
        <Suspense fallback={null}>
          <TimePanel
            initialHours={initialHours}
            onChange={setHours}
            initialDraft={files}
            onDraft={setDraft}
          />
        </Suspense>
      )}
    </LookContext.Provider>
  )
}
