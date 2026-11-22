import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEne, parseEneSnapshot } from './eneFetch'
import { eneUrlFrom } from './realtime'
import { SchemaMismatchError } from './realtimeFetch'

const valid = () => ({
  version: 1,
  generatedAt: 1_000_000,
  dropped: 0,
  outages: [{ code: 'EL358', reason: 'Maintenance', since: 999_000, returnAt: 1_003_600 }],
})

describe('parseEneSnapshot', () => {
  it('accepts a valid body, with null reason and returnAt', () => {
    expect(parseEneSnapshot(valid()).outages[0]!.code).toBe('EL358')
    const open = { ...valid(), outages: [{ code: 'ES1', reason: null, since: 1, returnAt: null }] }
    expect(parseEneSnapshot(open).outages[0]).toEqual({ code: 'ES1', reason: null, since: 1, returnAt: null })
  })

  it('throws SchemaMismatchError for another version', () => {
    expect(() => parseEneSnapshot({ ...valid(), version: 2 })).toThrow(SchemaMismatchError)
  })

  it('rejects a bad generatedAt, a non-array outages, and a bad row, naming the row', () => {
    expect(() => parseEneSnapshot({ ...valid(), generatedAt: 'x' })).toThrow('generatedAt')
    expect(() => parseEneSnapshot({ ...valid(), outages: {} })).toThrow('outages')
    expect(() => parseEneSnapshot({ ...valid(), outages: [null] })).toThrow('outage 0')
    expect(() => parseEneSnapshot({ ...valid(), outages: [{ code: 358, reason: null, since: 1, returnAt: null }] })).toThrow('outage 0')
    expect(() => parseEneSnapshot({ ...valid(), outages: [{ code: 'A', reason: null, since: 1, returnAt: '6 AM' }] })).toThrow('outage 0 (A)')
  })
})

describe('fetchEne', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signal = () => new AbortController().signal
  const stub = (res: () => Response) => vi.stubGlobal('fetch', vi.fn(async () => res()))

  it('returns the snapshot', async () => {
    stub(() => new Response(JSON.stringify(valid())))
    expect(await fetchEne('http://w/ene', signal())).toMatchObject({ ok: true, snapshot: { generatedAt: 1_000_000 } })
  })

  it('flags a 503 warming body, with its Retry-After', async () => {
    stub(() => new Response('{"error":"warming"}', { status: 503, headers: { 'Retry-After': '2' } }))
    expect(await fetchEne('http://w/ene', signal())).toEqual({ ok: false, warming: true, schemaMismatch: false, error: 'HTTP 503 warming', retryAfterS: 2 })
  })

  it('reports other statuses, bad bodies and a version mismatch as failures, never throws', async () => {
    stub(() => new Response('nope', { status: 500 }))
    expect(await fetchEne('http://w/ene', signal())).toMatchObject({ ok: false, warming: false, error: 'HTTP 500' })
    stub(() => new Response('{not json'))
    expect(await fetchEne('http://w/ene', signal())).toMatchObject({ ok: false })
    stub(() => new Response(JSON.stringify({ ...valid(), version: 2 })))
    expect(await fetchEne('http://w/ene', signal())).toMatchObject({ ok: false, schemaMismatch: true })
  })

  it('reports a network error as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await fetchEne('http://w/ene', signal())).toMatchObject({ ok: false, error: 'Failed to fetch' })
  })

  it('rethrows when the caller aborted', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      c.abort()
      throw new DOMException('aborted', 'AbortError')
    }))
    await expect(fetchEne('http://w/ene', c.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('eneUrlFrom', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is the /ene sibling of the /rt URL', () => {
    expect(eneUrlFrom('https://x.workers.dev/rt')).toBe('https://x.workers.dev/ene')
    expect(eneUrlFrom('http://localhost:8787/rt')).toBe('http://localhost:8787/ene')
    expect(eneUrlFrom('https://x.workers.dev/rt?x=1')).toBe('https://x.workers.dev/ene')
  })

  it('is null, and logged, for a URL that does not parse', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(eneUrlFrom('not a url')).toBeNull()
    expect(error).toHaveBeenCalledOnce()
  })

  it('never gives an MTA host: the client talks only to the Worker', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const rt of ['https://api.mta.info/rt', 'https://mta.info/rt', 'https://web.mta.info:443/rt']) {
      expect(eneUrlFrom(rt), rt).toBeNull()
    }
    for (const rt of ['https://x.workers.dev/rt', 'http://localhost:8787/rt', 'https://rt.example.org/rt']) {
      expect(new URL(eneUrlFrom(rt)!).hostname.endsWith('mta.info'), rt).toBe(false)
    }
    expect(error).toHaveBeenCalledTimes(3)
  })
})
