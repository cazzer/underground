import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const ALLOWED = 'https://cazzer.github.io'
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rt.example${path}`, init) as never, {} as never, ctx)

beforeEach(() => {
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => undefined } })
  // Nothing here may reach upstream: a call would fail loudly.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')))
})
afterEach(() => vi.unstubAllGlobals())

describe('routing', () => {
  it('answers a preflight on every route', async () => {
    for (const path of ['/rt', '/ene', '/geocode']) {
      const res = await call(path, { method: 'OPTIONS', headers: { Origin: ALLOWED } })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    }
  })

  it('answers 405 to other methods and 404 to unknown paths', async () => {
    for (const path of ['/rt', '/ene', '/geocode']) {
      const res = await call(path, { method: 'POST' })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('GET, OPTIONS')
    }
    expect((await call('/nope')).status).toBe(404)
  })

  it('serves /geocode (403 with no allowed Origin, 400 for a short query), not a 404', async () => {
    expect((await call('/geocode?q=barclays')).status).toBe(403)
    const short = await call('/geocode?q=ab', { headers: { Origin: ALLOWED } })
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: 'bad-query' })
  })
})
