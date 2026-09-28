import { createContext, useContext } from 'react'
import type { Look } from './look'
import type { Sun } from './sun'

export interface TimeOfDay {
  hours: number
  look: Look
  sun: Sun
  /** A cool fill from roughly opposite the sun, for the night (D-038). */
  moon: Sun
}

export const LookContext = createContext<TimeOfDay | null>(null)

/** The time of day, resolved once per change for everything that lights the scene. */
export function useLook(): TimeOfDay {
  const value = useContext(LookContext)
  if (!value) throw new Error('useLook needs a <LookProvider>')
  return value
}
