import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createLookMiddleware } from './vitePlugin'

type FakeReq = EventEmitter & { method: string; headers: Record<string, string | undefined> }

function fakeReq(method: string, headers: Record<string, string | undefined>): FakeReq {
  const req = new EventEmitter() as FakeReq
  req.method = method
  req.headers = headers
  return req
}

function fakeRes(): { res: ServerResponse; ended: Promise<{ status: number; text: string }> } {
  let resolveEnd!: (value: { status: number; text: string }) => void
  const ended = new Promise<{ status: number; text: string }>((resolve) => {
    resolveEnd = resolve
  })
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: (text: string) => {
      resolveEnd({ status: (res as { statusCode: number }).statusCode, text })
      return res
    },
  }
  return { res: res as unknown as ServerResponse, ended }
}

/** Emits `body` once the handler starts reading, so the read never hangs. */
async function emitBodyWhenReady(req: FakeReq, body: string): Promise<void> {
  for (let i = 0; i < 200 && req.listenerCount('end') === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  req.emit('data', body)
  req.emit('end')
}

describe('createLookMiddleware', () => {
  it('passes non-POSTs to next() without touching the response', () => {
    const handler = createLookMiddleware()
    const next = vi.fn()
    const { res } = fakeRes()
    handler(fakeReq('GET', {}) as unknown as IncomingMessage, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
  })

  it('rejects a foreign Origin with 403 before reading the body', async () => {
    const handler = createLookMiddleware()
    const req = fakeReq('POST', { origin: 'https://evil.com', host: 'localhost:5173' })
    const { res, ended } = fakeRes()
    handler(req as unknown as IncomingMessage, res, vi.fn())
    const { status, text } = await ended
    expect(status).toBe(403)
    expect(JSON.parse(text)).toEqual({ error: 'cross-origin look writes are forbidden' })
    expect(req.listenerCount('data')).toBe(0)
  })

  it('rejects a missing Origin with 403 and writes nothing', async () => {
    const handler = createLookMiddleware()
    const req = fakeReq('POST', { host: 'localhost:5173' })
    const { res, ended } = fakeRes()
    handler(req as unknown as IncomingMessage, res, vi.fn())
    const { status, text } = await ended
    expect(status).toBe(403)
    expect(JSON.parse(text)).toHaveProperty('error')
    expect(req.listenerCount('data')).toBe(0)
  })

  it('still reaches the body parser for a same-origin POST (400 on bad JSON)', async () => {
    const handler = createLookMiddleware()
    const req = fakeReq('POST', { origin: 'http://localhost:5173', host: 'localhost:5173' })
    const { res, ended } = fakeRes()
    handler(req as unknown as IncomingMessage, res, vi.fn())
    await emitBodyWhenReady(req, 'not json')
    const { status, text } = await ended
    expect(status).toBe(400)
    expect(JSON.parse(text)).toHaveProperty('error')
  })
})
