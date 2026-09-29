import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialDraft } from './look'
import { postLookDraft } from './lookSave'

function stubFetch(handler: (url: string, init: RequestInit) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => handler(url, init)),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postLookDraft', () => {
  it('POSTs the palette JSON and resolves on ok', async () => {
    const seen: { current: { url: string; body: unknown } | null } = { current: null }
    stubFetch(async (url, init) => {
      seen.current = { url, body: JSON.parse(init.body as string) }
      return { ok: true, json: async () => ({ ok: true }) }
    })
    const draft = initialDraft()
    await postLookDraft('palette', draft)
    expect(seen.current?.url).toBe('/__folia/look')
    expect(seen.current?.body).toEqual({ file: 'palette', data: draft.palette })
  })

  it('POSTs the keyframes array', async () => {
    const seen: { current: unknown } = { current: null }
    stubFetch(async (_url, init) => {
      seen.current = JSON.parse(init.body as string)
      return { ok: true, json: async () => ({ ok: true }) }
    })
    const draft = initialDraft()
    await postLookDraft('keyframes', draft)
    expect(seen.current).toEqual({ file: 'keyframes', data: draft.keyframes })
  })

  it('throws the server error on failure', async () => {
    stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad hex' }) }))
    await expect(postLookDraft('palette', initialDraft())).rejects.toThrowError('bad hex')
  })
})
