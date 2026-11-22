import { describe, expect, it, vi } from 'vitest'
import { GEOCODE_SOURCE_BACKOFF_MS } from './cache'
import { shouldBackOff, type GeocodeFetchError, type SourceOutcome } from './geocodeOutcome'
import {
  FAILED,
  GS_EMPTY,
  GS_PLACE,
  PH_KATZ,
  T0,
  bodyOf,
  fakeCtx,
  fakeEdge,
  get,
  harness,
  installFakeClock,
} from './serveHarness'

installFakeClock()

const failedWith = (error: GeocodeFetchError): SourceOutcome => ({ status: 'failed', error })

describe('shouldBackOff', () => {
  it('backs off on a struggling source, not on a failure a query can cause', () => {
    for (const e of ['timeout', 'fetch-failed', 'http-429', 'http-500', 'http-503', 'http-599'] as const) {
      expect(shouldBackOff(e)).toBe(true)
    }
    for (const e of ['http-400', 'http-404', 'http-422', 'bad-shape', 'parse-failed', 'too-large'] as const) {
      expect(shouldBackOff(e)).toBe(false)
    }
  })

  it('is what serveGeocode acts on: a 404 does not skip the next call, a 429 does', async () => {
    const quiet = harness(GS_EMPTY, failedWith('http-404'))
    await get(quiet, 'q=zzz+aaa')
    await get(quiet, 'q=zzz+bbb')
    expect(quiet.fetchPhoton).toHaveBeenCalledTimes(2)

    const busy = harness(GS_EMPTY, failedWith('http-429'))
    await get(busy, 'q=zzz+aaa')
    await get(busy, 'q=zzz+bbb')
    expect(busy.fetchPhoton).toHaveBeenCalledTimes(1)
  })
})

describe('failures', () => {
  it('does not cache a partial answer, and backs a failed source off for 30 s', async () => {
    const deps = harness(GS_EMPTY, FAILED)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    const first = await get(deps, "q=Katz's+Deli", edge, ctx)
    expect(first.status).toBe(200)
    expect((await bodyOf(first)).incomplete).toBe(true)

    // Not cached, and Photon is still backed off: GeoSearch alone is asked again.
    const second = await get(deps, "q=Katz's+Deli", edge, ctx)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(2)
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(1)
    expect((await bodyOf(second)).incomplete).toBe(true)
    // An incomplete answer is never written to the edge cache either.
    await ctx.flush()
    expect(edge.store.size).toBe(0)

    vi.setSystemTime(T0 + GEOCODE_SOURCE_BACKOFF_MS)
    deps.fetchPhoton.mockResolvedValue(PH_KATZ)
    const third = await get(deps, "q=Katz's+Deli", edge, ctx)
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(2)
    expect((await bodyOf(third)).incomplete).toBe(false)
    await ctx.flush()
    expect(edge.store.size).toBe(1)
    await get(deps, "q=Katz's+Deli", edge, ctx)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(3)
  })

  it('answers 502 when every source called failed, and does not cache it', async () => {
    const deps = harness(FAILED, FAILED)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    const res = await get(deps, 'q=zzz+qqq', edge, ctx)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cazzer.github.io')
    await ctx.flush()
    expect(edge.store.size).toBe(0)
  })

  it('treats a fetcher that rejects as a fixed fetch-failed, never throwing', async () => {
    const deps = harness()
    deps.fetchGeoSearch.mockRejectedValue(new Error('boom'))
    deps.fetchPhoton.mockRejectedValue(new Error('boom'))
    expect((await get(deps, 'q=zzz+qqq')).status).toBe(502)
  })
})

describe('limits', () => {
  it('stops calling Photon past its bucket (5, then 0.5 a second) and says the answer is incomplete', async () => {
    const deps = harness(GS_EMPTY, PH_KATZ)
    const results = []
    for (let i = 0; i < 6; i++) results.push(await get(deps, `q=zzz+q${i}`))
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(5)
    expect((await bodyOf(results[5] as Response)).incomplete).toBe(true)
    vi.setSystemTime(T0 + 2000)
    await get(deps, 'q=zzz+q6')
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(6)
  })

  it('answers 503 busy once the upstream bucket (20, then 2 a second) is empty, exposing retry-after', async () => {
    const deps = harness(GS_PLACE)
    for (let i = 0; i < 20; i++) expect((await get(deps, `q=name+${i}`)).status).toBe(200)
    const res = await get(deps, 'q=name+20')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'busy' })
    expect(res.headers.get('retry-after')).toBe('1')
    expect(res.headers.get('access-control-expose-headers')).toBe('retry-after')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(20)
  })

  it('says how long a backed off source has left when nothing could be called', async () => {
    const deps = harness(FAILED, FAILED)
    await get(deps, 'q=zzz+qqq')
    vi.setSystemTime(T0 + 10_000)
    const res = await get(deps, 'q=zzz+qqq')
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('20')
  })
})
