import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEED_IDS, RT_SCHEMA_VERSION } from './realtime'
import { fetchSnapshot, parseRetryAfter, parseSnapshot } from './realtimeFetch'

function valid(): Record<string, unknown> {
  return {
    version: RT_SCHEMA_VERSION,
    generatedAt: 1_795_228_554,
    feeds: Object.fromEntries(FEED_IDS.map((id) => [id, { headerTimestamp: 1, error: null, stale: false, droppedEntities: 0, trips: [] }])),
  }
}

describe('parseSnapshot', () => {
  it('accepts a complete snapshot unchanged', () => {
    const raw = valid()
    expect(parseSnapshot(raw)).toBe(raw)
  })

  it('names both versions when the schema differs', () => {
    expect(() => parseSnapshot({ ...valid(), version: 2 })).toThrow('realtime schema v2, client expects v1; reload')
  })

  it('rejects non-objects, a missing feed, a non-array trips, and a bad generatedAt', () => {
    expect(() => parseSnapshot(null)).toThrow('not an object')
    const missing = valid()
    delete (missing.feeds as Record<string, unknown>).l
    expect(() => parseSnapshot(missing)).toThrow('missing feed "l"')
    const bad = valid()
    ;(bad.feeds as Record<string, Record<string, unknown>>).g!.trips = 'x'
    expect(() => parseSnapshot(bad)).toThrow('missing feed "g"')
    expect(() => parseSnapshot({ ...valid(), generatedAt: '12' })).toThrow('generatedAt')
    expect(() => parseSnapshot({ ...valid(), generatedAt: NaN })).toThrow('generatedAt')
  })
})

describe('parseRetryAfter', () => {
  const NOW = Date.parse('2026-11-20T12:00:00Z')
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('5', NOW)).toBe(5)
    expect(parseRetryAfter('Fri, 20 Nov 2026 12:00:10 GMT', NOW)).toBe(10)
  })
  it('gives null for absent, negative, past or garbage values', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter('-1', NOW)).toBeNull()
    expect(parseRetryAfter('x', NOW)).toBeNull()
    expect(parseRetryAfter('Fri, 20 Nov 2026 11:59:00 GMT', NOW)).toBeNull()
  })
})

describe('fetchSnapshot', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signal = () => new AbortController().signal
  const stub = (res: () => Response) => vi.stubGlobal('fetch', vi.fn(async () => res()))

  it('returns the snapshot with the headers it can read', async () => {
    stub(() => new Response(JSON.stringify(valid()), { headers: { 'X-Rt-Cache': 'HIT' } }))
    const r = await fetchSnapshot('http://w/rt', signal())
    expect(r).toMatchObject({ ok: true, cache: 'HIT' })
  })

  it('flags a 503 warming body, with its Retry-After', async () => {
    stub(() => new Response('{"error":"warming"}', { status: 503, headers: { 'Retry-After': '2' } }))
    expect(await fetchSnapshot('http://w/rt', signal())).toEqual({ ok: false, warming: true, schemaMismatch: false, error: 'HTTP 503 warming', retryAfterS: 2 })
  })

  it('reports other statuses and unparseable bodies as failures, never throws', async () => {
    stub(() => new Response('nope', { status: 500 }))
    expect(await fetchSnapshot('http://w/rt', signal())).toMatchObject({ ok: false, warming: false, error: 'HTTP 500' })
    stub(() => new Response('{not json'))
    expect(await fetchSnapshot('http://w/rt', signal())).toMatchObject({ ok: false })
  })

  it('flags a schema version mismatch', async () => {
    stub(() => new Response(JSON.stringify({ ...valid(), version: 2 })))
    expect(await fetchSnapshot('http://w/rt', signal())).toMatchObject({ ok: false, schemaMismatch: true })
  })

  it('reports a network error as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await fetchSnapshot('http://w/rt', signal())).toMatchObject({ ok: false, error: 'Failed to fetch' })
  })

  it('rethrows when the caller aborted', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      c.abort()
      throw new DOMException('aborted', 'AbortError')
    }))
    await expect(fetchSnapshot('http://w/rt', c.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
