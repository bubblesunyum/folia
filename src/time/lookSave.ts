import type { LookDraft } from './look'

// POSTs the bench's working copy to the dev server's `/__folia/look`
// endpoint, which validates it and writes the files. Split out of `TimePanel`
// so the network contract is unit-testable without rendering leva.
export async function postLookDraft(
  file: 'palette' | 'keyframes',
  draft: LookDraft,
): Promise<void> {
  const res = await fetch('/__folia/look', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, data: file === 'palette' ? draft.palette : draft.keyframes }),
  })
  const body = (await res.json()) as { ok?: true; error?: string }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `save failed (${res.status})`)
}
