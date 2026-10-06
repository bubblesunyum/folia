import { useThree } from '@react-three/fiber'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

const RestoresContext = createContext(0)

/**
 * How many times the WebGL context has been restored. three rebuilds its own
 * state on restore, but anything drawn once into a render target (the env map,
 * the composer's buffers) or holding its own GL handles (the timer query)
 * must redo that work, so those key their setup on this count (D-043).
 */
export function useContextRestores(): number {
  return useContext(RestoresContext)
}

// three.js already calls preventDefault on loss, which is what allows the restore.
export function ContextLossProvider({
  onLostChange,
  children,
}: {
  onLostChange: (lost: boolean) => void
  children: ReactNode
}) {
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const [restores, setRestores] = useState(0)
  // The parent re-renders around every restore; a ref keeps that from
  // resubscribing the canvas listeners each time.
  const lostChange = useRef(onLostChange)
  lostChange.current = onLostChange
  useEffect(() => {
    const lost = (event: Event) => {
      // Belt and braces beside three's own handler: without a
      // preventDefault the context can never come back.
      event.preventDefault()
      lostChange.current(true)
    }
    const restored = () => {
      lostChange.current(false)
      setRestores((count) => count + 1)
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [canvas])
  // The redo signal, readable by specs: loss never unmounts the canvas, so a
  // restore must bump this rather than rebuild the flag from scratch.
  useEffect(() => {
    canvas.dataset.restores = String(restores)
    if (restores > 0) {
      // Demand frameloop draws nothing unasked: kick the post-restore frame
      // explicitly, so env/composer/reflection redo work actually paints.
      invalidate()
    }
  }, [canvas, restores, invalidate])
  return <RestoresContext.Provider value={restores}>{children}</RestoresContext.Provider>
}
