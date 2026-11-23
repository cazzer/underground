import { describe, expect, it, vi } from 'vitest'
import { GEOCODE_TTL_MS } from './cache'
import type { SourceOutcome } from './geocodeOutcome'
import {
  ALLOWED,
  GS_ADDRESS,
  GS_EMPTY,
  PH_KATZ,
  bodyOf,
  fakeCtx,
  fakeEdge,
  get,
  harness,
  installFakeClock,
  T0,
} from './serveHarness'

installFakeClock()

describe('caching', () => {
  it('fetches on a miss, then serves memory, never letting the browser cache it', async () => {
    const deps = harness()
    const first = await get(deps, 'q=Barclays+Center')
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    const second = await get(deps, 'q=barclays++center')
    expect(second.headers.get('cache-control')).toBe('no-store')
    expect(await second.text()).toBe(await first.text())
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it('sends no x-rt-cache header: it would tell one user whether another just searched the same text', async () => {
    const deps = harness()
    const responses = [
      await get(deps, 'q=barclays+center'),
      await get(deps, 'q=barclays+center'),
      await get(deps, 'q=ab'),
      await get(deps, 'q=barclays+center', fakeEdge(), fakeCtx(), null),
    ]
    for (const res of responses) expect(res.headers.has('x-rt-cache')).toBe(false)
  })

  it('keys by focus rounded to 2 decimals', async () => {
    const deps = harness()
    await get(deps, 'q=barclays+center&focus=40.7301,-73.9899')
    await get(deps, 'q=barclays+center&focus=40.7304,-73.9902')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
    await get(deps, 'q=barclays+center&focus=40.75,-73.99')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(2)
  })

  it('serves an edge hit from a new isolate without fetching, and fills memory', async () => {
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await get(harness(), 'q=barclays+center', edge, ctx)
    await ctx.flush()
    expect([...edge.store.keys()]).toEqual(['https://w.example/geocode?v=2&q=barclays%20center&f='])

    const fresh = harness()
    const res = await get(fresh, 'q=barclays+center', edge)
    expect((await bodyOf(res)).results).toHaveLength(1)
    expect(fresh.fetchGeoSearch).not.toHaveBeenCalled()
    // Memory now holds it: an empty edge no longer matters.
    await get(fresh, 'q=barclays+center')
    expect(fresh.fetchGeoSearch).not.toHaveBeenCalled()
  })

  it('refetches after an hour', async () => {
    const deps = harness()
    await get(deps, 'q=barclays+center')
    vi.setSystemTime(T0 + GEOCODE_TTL_MS)
    await get(deps, 'q=barclays+center')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(2)
  })

  it('carries on to upstream when the edge cache cannot be read, logging only a fixed code', async () => {
    const edge = fakeEdge()
    edge.match = () => Promise.reject(new Error('match q=barclays'))
    const deps = harness()
    const res = await get(deps, 'q=barclays+center', edge)
    expect(res.status).toBe(200)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith('{"event":"geocode-edge-read-failed"}')
  })
})

describe('which sources are called', () => {
  it('calls both at once for a business query, Photon first in the answer', async () => {
    let finishGs!: (o: SourceOutcome) => void
    let finishPh!: (o: SourceOutcome) => void
    const deps = harness()
    deps.fetchGeoSearch.mockReturnValue(new Promise((r) => (finishGs = r)))
    deps.fetchPhoton.mockReturnValue(new Promise((r) => (finishPh = r)))
    const pending = get(deps, "q=Katz's+Deli")
    await vi.waitFor(() => {
      expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
      expect(deps.fetchPhoton).toHaveBeenCalledTimes(1)
    })
    finishGs(GS_EMPTY)
    finishPh(PH_KATZ)
    const body = await bodyOf(await pending)
    expect(body.results.map((r) => r.source)).toEqual(['photon'])
    expect(body.incomplete).toBe(false)
  })

  it('skips Photon when an address query has an address hit', async () => {
    const deps = harness(GS_ADDRESS)
    const body = await bodyOf(await get(deps, 'q=120+Broadway'))
    expect(deps.fetchPhoton).not.toHaveBeenCalled()
    expect(body.results).toHaveLength(3)
    expect(body.incomplete).toBe(false)
  })

  it('calls Photon after GeoSearch when it had no place for a name query', async () => {
    const deps = harness(GS_ADDRESS)
    await get(deps, 'q=equitable+building')
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(1)
    const empty = harness(GS_EMPTY)
    await get(empty, 'q=zzz+qqq')
    expect(empty.fetchPhoton).toHaveBeenCalledTimes(1)
  })
})

describe('request validation', () => {
  it('answers 400 for a bad query or focus, with CORS headers', async () => {
    const deps = harness()
    const short = await get(deps, 'q=ab')
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: 'bad-query' })
    expect(short.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    const focus = await get(deps, 'q=abc&focus=1,2,3')
    expect(await focus.json()).toEqual({ error: 'bad-focus' })
    expect(deps.fetchGeoSearch).not.toHaveBeenCalled()
  })

  it('answers 403 without an allowed origin, before any work', async () => {
    const deps = harness()
    for (const origin of [null, 'https://evil.example']) {
      const res = await get(deps, 'q=barclays+center', fakeEdge(), fakeCtx(), origin)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden' })
      expect(res.headers.get('vary')).toBe('Origin')
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    }
    expect((await get(deps, 'q=barclays+center', fakeEdge(), fakeCtx(), 'http://localhost:5173')).status).toBe(200)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it('answers 500 internal when something unexpected throws', async () => {
    const deps = harness()
    deps.state.lru.get = () => {
      throw new Error('boom')
    }
    const res = await get(deps, 'q=barclays+center')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
