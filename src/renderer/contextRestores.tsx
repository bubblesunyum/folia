import { useThree } from '@react-three/fiber'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

const RestoresContext = createContext(0)

/**
 * How many times the WebGL context has been restored. three rebuilds its own
 * state on restore, but anything drawn once into a render target (the env map)
 * or holding its own GL handles (the timer query) must redo that work, so
 * those key their setup on this count (D-043).
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
  const [restores, setRestores] = useState(0)
  useEffect(() => {
    const lost = () => onLostChange(true)
    const restored = () => {
      onLostChange(false)
      setRestores((count) => count + 1)
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [canvas, onLostChange])
  return <RestoresContext.Provider value={restores}>{children}</RestoresContext.Provider>
}
