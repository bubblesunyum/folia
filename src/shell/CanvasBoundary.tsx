import { Component, type ReactNode } from 'react'
import { SkyShell } from './SkyShell'

interface CanvasBoundaryState {
  failed: boolean
}

/**
 * Keeps the sky shell up if the canvas chunk fails to load — a cached `/`
 * from a previous deploy can reference a hashed chunk the new deploy dropped.
 */
export class CanvasBoundary extends Component<{ children: ReactNode }, CanvasBoundaryState> {
  state: CanvasBoundaryState = { failed: false }

  static getDerivedStateFromError(): CanvasBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('folia: canvas chunk failed', error)
  }

  render(): ReactNode {
    return this.state.failed ? <SkyShell /> : this.props.children
  }
}
