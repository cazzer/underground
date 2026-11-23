import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import type { AlertsSnapshot } from './schema'

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
    for (const path of ['/rt', '/ene', '/alerts', '/geocode']) {
      const res = await call(path, { method: 'OPTIONS', headers: { Origin: ALLOWED } })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    }
  })

  it('answers 405 to other methods and 404 to unknown paths', async () => {
    for (const path of ['/rt', '/ene', '/alerts', '/geocode']) {
      const res = await call(path, { method: 'POST' })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('GET, OPTIONS')
    }
    expect((await call('/nope')).status).toBe(404)
  })

  it('serves /alerts from the recorded feed: trimmed JSON, headers verbatim, CORS, one counts-only log line', async () => {
    const upstream = readFileSync(new URL('../fixtures/alerts.json', import.meta.url), 'utf8')
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response(upstream)
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1795465325 * 1000)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const res = await call('/alerts', { headers: { Origin: ALLOWED } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
      const body = (await res.json()) as AlertsSnapshot
      expect(fetched).toEqual(['https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json'])
      expect(body).toMatchObject({ version: 1, generatedAt: 1795465325, dropped: 0 })
      const skip = body.alerts.find((a) => a.id === 'lmm:planned_work:35124')
      expect(skip?.header).toBe('Downtown [1] skips 125 St')
      const line = JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>
      expect(line).toMatchObject({ event: 'alerts-miss', alerts: 9, dropped: 0, outsideWindow: 3 })
      expect(JSON.stringify(line)).not.toContain('Downtown')
    } finally {
      log.mockRestore()
      vi.useRealTimers()
    }
  })

  it('serves /geocode (403 with no allowed Origin, 400 for a short query), not a 404', async () => {
    expect((await call('/geocode?q=barclays')).status).toBe(403)
    const short = await call('/geocode?q=ab', { headers: { Origin: ALLOWED } })
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: 'bad-query' })
  })
})
