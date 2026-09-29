import { advance, Canvas, useFrame } from '@react-three/fiber'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { renderConfig } from '../debug'
import { ContextLossProvider } from './contextRestores'

/**
 * The one canvas, configured per D-043: no default-framebuffer MSAA (the composer
 * owns AA), opaque, no renderer tone mapping (the composer owns it), and
 * PCFShadowMap with shadows enabled once at boot and never toggled. Its size,
 * DPR and frame cap come from `renderConfig` (`?perf=base`, `?aa=`).
 */
export function Viewport({
  children,
  onFirstFrame,
}: {
  children: ReactNode
  onFirstFrame?: () => void
}) {
  const [contextLost, setContextLost] = useState(false)
  const { dpr, maxFps, size } = renderConfig
  return (
    <>
      <div className="viewport" style={size ?? undefined}>
        <Canvas
          flat
          shadows="percentage"
          dpr={dpr}
          frameloop={maxFps ? 'never' : 'demand'}
          gl={{ antialias: false, alpha: false }}
          camera={{ fov: 18, near: 1, far: 300, position: [40, 34, 40] }}
        >
          <RenderedFlag onFirstFrame={onFirstFrame} />
          <ContextLossProvider onLostChange={setContextLost}>{children}</ContextLossProvider>
        </Canvas>
      </div>
      {maxFps && <FrameCap fps={maxFps} />}
      {contextLost && <div className="context-lost">Reconnecting</div>}
    </>
  )
}

// A few ms of slack, so a 120 Hz display lands on every other vsync, not a
// jittering mix of one and two.
const CAP_SLACK_MS = 4

/** Drives the frame loop itself, no faster than `fps`. */
function FrameCap({ fps }: { fps: number }) {
  useEffect(() => {
    const interval = 1000 / fps
    let last = Number.NEGATIVE_INFINITY
    let id = 0
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (now - last < interval - CAP_SLACK_MS) return
      last = now
      // R3F sets its clock straight from this under frameloop 'never': seconds.
      advance(now / 1000)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [fps])
  return null
}

const FRAMES_BEFORE_RENDERED = 1

// Marks the canvas once real frames have been drawn, so tests can wait on
// pixels rather than on a timeout.
function RenderedFlag({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const frames = useRef(0)
  const reported = useRef(false)
  useFrame(({ gl }) => {
    frames.current += 1
    if (frames.current === FRAMES_BEFORE_RENDERED) {
      gl.domElement.dataset.rendered = 'true'
      if (!reported.current) {
        reported.current = true
        onFirstFrame?.()
      }
    }
  })
  return null
}
