import type { ComponentType } from 'react'
import { type CaseContent, CasePanel } from './Panel'

// The kind → renderer registry (D-019): new content kinds register a
// renderer here instead of rewriting routing. Fails closed on unknown kinds.
const renderers = {
  panel: CasePanel,
} satisfies Record<string, ComponentType<{ content: CaseContent }>>

export type PanelRenderer = ComponentType<{ content: CaseContent }>

export function rendererFor(kind: string): PanelRenderer {
  const renderer: PanelRenderer | undefined = renderers[kind as keyof typeof renderers]
  if (renderer === undefined) throw new Error(`unknown case kind "${kind}"`)
  return renderer
}
