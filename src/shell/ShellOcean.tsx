/**
 * The cream-ocean first paint (D-018): opaque cream below the sky, the static
 * stand-in for the WebGL ocean until the canvas takes over. Both shells read
 * the same palette cream, so the handoff crossfades instead of cutting.
 * Shell code only: this module must never import three or R3F (D-047).
 */
export function ShellOcean({ testId }: { testId?: string }) {
  return (
    <div
      aria-hidden="true"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '42%',
        background: 'linear-gradient(to bottom, transparent, var(--cream) 60%)',
      }}
    />
  )
}
