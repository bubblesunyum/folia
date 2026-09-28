import { Canvas, useFrame } from '@react-three/fiber'
import { type ReactNode, useRef, useState } from 'react'
import { ContextLossProvider } from './contextRestores'

/**
 * The one canvas, configured per D-043: no default-framebuffer MSAA (the composer
 * owns AA), opaque, no renderer tone mapping (the composer owns it), and
 * PCFShadowMap with shadows enabled once at boot and never toggled.
 */
export function Viewport({ children }: { children: ReactNode }) {
  const [contextLost, setContextLost] = useState(false)
  return (
    <>
      <Canvas
        flat
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false }}
        camera={{ fov: 18, near: 1, far: 300, position: [40, 34, 40] }}
      >
        <RenderedFlag />
        <ContextLossProvider onLostChange={setContextLost}>{children}</ContextLossProvider>
      </Canvas>
      {contextLost && <div className="context-lost">Reconnecting</div>}
    </>
  )
}

const FRAMES_BEFORE_RENDERED = 10

// Marks the canvas once real frames have been drawn, so tests can wait on
// pixels rather than on a timeout.
function RenderedFlag() {
  const frames = useRef(0)
  useFrame(({ gl }) => {
    frames.current += 1
    if (frames.current === FRAMES_BEFORE_RENDERED) gl.domElement.dataset.rendered = 'true'
  })
  return null
}
