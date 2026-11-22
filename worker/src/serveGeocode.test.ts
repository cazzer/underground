import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { GEOCODE_SOURCE_BACKOFF_MS, GEOCODE_TTL_MS } from './cache'
import type { EdgeCache } from './edgeCache'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import type { SourceOutcome } from './geocodeOutcome'
import type { GeocodeQuery } from './geocodeQuery'
import type { GeocodeResponse } from './schema'
import { createGeocodeState, serveGeocode, type GeocodeDeps } from './serveGeocode'

const T0 = 1_800_000_000_000
const ALLOWED = 'https://cazzer.github.io'

const ok = (candidates: ReturnType<typeof geoSearchCandidates>): SourceOutcome => ({
  status: 'ok',
  results: { candidates, dropped: 0, outside: 0 },
  cacheStatus: null,
})
const GS_PLACE = ok(geoSearchCandidates('barclays center'))
const GS_ADDRESS = ok(geoSearchCandidates('120 broadway'))
const GS_EMPTY = ok([])
const PH_KATZ = ok(photonCandidates("katz's deli"))
const FAILED: SourceOutcome = { status: 'failed', error: 'http-503' }

function fakeEdge(): EdgeCache & { store: Map<string, Response> } {
  const store = new Map<string, Response>()
  return {
    store,
    async match(request) {
      return store.get(request.url)?.clone()
    },
    async put(request, response) {
      store.set(request.url, response)
    },
  }
}

function fakeCtx(): { waitUntil(p: Promise<unknown>): void; flush(): Promise<void> } {
  const pending: Promise<unknown>[] = []
  return { waitUntil: (p) => void pending.push(p), flush: async () => void (await Promise.all(pending)) }
}

type Fetcher = Mock<(q: GeocodeQuery) => Promise<SourceOutcome>>
interface Harness extends GeocodeDeps {
  fetchGeoSearch: Fetcher
  fetchPhoton: Fetcher
}

function harness(gs: SourceOutcome = GS_PLACE, ph: SourceOutcome = PH_KATZ): Harness {
  return {
    fetchGeoSearch: vi.fn(async () => gs),
    fetchPhoton: vi.fn(async () => ph),
    state: createGeocodeState(Date.now()),
  }
}

const get = (deps: GeocodeDeps, qs: string, edge: EdgeCache = fakeEdge(), ctx = fakeCtx(), origin: string | null = ALLOWED) =>
  serveGeocode(new Request(`https://w.example/geocode?${qs}`), ctx, origin, edge, deps)
const bodyOf = async (res: Response) => JSON.parse(await res.text()) as GeocodeResponse

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('caching', () => {
  it('fetches on a miss, then serves memory with a private max-age', async () => {
    const deps = harness()
    const first = await get(deps, 'q=Barclays+Center')
    expect(first.headers.get('x-rt-cache')).toBe('miss')
    expect(first.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(first.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    const second = await get(deps, 'q=barclays++center')
    expect(second.headers.get('x-rt-cache')).toBe('memory')
    expect(await second.text()).toBe(await first.text())
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it('keys by focus rounded to 2 decimals', async () => {
    const deps = harness()
    await get(deps, 'q=barclays+center&focus=40.7301,-73.9899')
    expect((await get(deps, 'q=barclays+center&focus=40.7304,-73.9902')).headers.get('x-rt-cache')).toBe('memory')
    expect((await get(deps, 'q=barclays+center&focus=40.75,-73.99')).headers.get('x-rt-cache')).toBe('miss')
  })

  it('serves an edge hit from a new isolate without fetching, and fills memory', async () => {
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await get(harness(), 'q=barclays+center', edge, ctx)
    await ctx.flush()
    expect([...edge.store.keys()]).toEqual(['https://w.example/geocode?v=1&q=barclays%20center&f='])

    const fresh = harness()
    const res = await get(fresh, 'q=barclays+center', edge)
    expect(res.headers.get('x-rt-cache')).toBe('edge')
    expect(fresh.fetchGeoSearch).not.toHaveBeenCalled()
    expect((await get(fresh, 'q=barclays+center')).headers.get('x-rt-cache')).toBe('memory')
  })

  it('refetches after an hour', async () => {
    const deps = harness()
    await get(deps, 'q=barclays+center')
    vi.setSystemTime(T0 + GEOCODE_TTL_MS)
    expect((await get(deps, 'q=barclays+center')).headers.get('x-rt-cache')).toBe('miss')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(2)
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

describe('failures and limits', () => {
  it('does not cache a partial answer, and backs a failed source off for 30 s', async () => {
    const deps = harness(GS_EMPTY, FAILED)
    const first = await get(deps, "q=Katz's+Deli")
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect((await bodyOf(first)).incomplete).toBe(true)

    // Not cached, and Photon is still backed off: GeoSearch alone is asked again.
    const second = await get(deps, "q=Katz's+Deli")
    expect(second.headers.get('x-rt-cache')).toBe('miss')
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(2)
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(1)
    expect((await bodyOf(second)).incomplete).toBe(true)

    vi.setSystemTime(T0 + GEOCODE_SOURCE_BACKOFF_MS)
    deps.fetchPhoton.mockResolvedValue(PH_KATZ)
    const third = await get(deps, "q=Katz's+Deli")
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(2)
    expect((await bodyOf(third)).incomplete).toBe(false)
    expect((await get(deps, "q=Katz's+Deli")).headers.get('x-rt-cache')).toBe('memory')
  })

  it('answers 502 when every source called failed, and does not cache it', async () => {
    const deps = harness(FAILED, FAILED)
    const res = await get(deps, 'q=zzz+qqq')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('treats a fetcher that rejects as a fixed fetch-failed, never throwing', async () => {
    const deps = harness()
    deps.fetchGeoSearch.mockRejectedValue(new Error('boom'))
    deps.fetchPhoton.mockRejectedValue(new Error('boom'))
    expect((await get(deps, 'q=zzz+qqq')).status).toBe(502)
  })

  it('stops calling Photon past its bucket (5, then 0.5 a second) and says the answer is incomplete', async () => {
    const deps = harness(GS_EMPTY, PH_KATZ)
    const results = []
    for (let i = 0; i < 6; i++) results.push(await get(deps, `q=zzz+q${i}`))
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(5)
    const sixth = await bodyOf(results[5] as Response)
    expect(sixth.incomplete).toBe(true)
    expect(results[5]?.headers.get('cache-control')).toBe('no-store')
    vi.setSystemTime(T0 + 2000)
    await get(deps, 'q=zzz+q6')
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(6)
  })

  it('answers 503 busy with retry-after once the upstream bucket (20, then 2 a second) is empty', async () => {
    const deps = harness(GS_PLACE)
    for (let i = 0; i < 20; i++) expect((await get(deps, `q=name+${i}`)).status).toBe(200)
    const res = await get(deps, 'q=name+20')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'busy' })
    expect(res.headers.get('retry-after')).toBe('1')
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
    const edge = fakeEdge()
    edge.match = () => Promise.reject(new Error('boom'))
    const res = await get(harness(), 'q=barclays+center', edge)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})

describe('privacy: no query or focus in any log', () => {
  const SECRET = 'zqxsecret deli'
  const FOCUS = 'focus=40.71,-74.00'

  it('keeps the query, its words and the focus out of console output in every scenario', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const leaky = (): Promise<SourceOutcome> => Promise.reject(new Error(`GET https://upstream/?q=${SECRET}&lat=40.71&lon=-74.00 failed`))
    const scenarios: Harness[] = [harness(GS_EMPTY, PH_KATZ), harness(FAILED, FAILED), harness(GS_PLACE, FAILED), harness(GS_EMPTY, GS_EMPTY)]
    const rejecting = harness()
    rejecting.fetchGeoSearch.mockImplementation(leaky)
    rejecting.fetchPhoton.mockImplementation(leaky)
    scenarios.push(rejecting)
    const busy = harness(GS_PLACE)
    for (let i = 0; i < 21; i++) await get(busy, `q=name+${i}&${FOCUS}`)

    for (const deps of scenarios) {
      const ctx = fakeCtx()
      const edge = fakeEdge()
      edge.put = () => Promise.reject(new Error(`put https://w.example/?q=${SECRET}`))
      await get(deps, `q=${encodeURIComponent(SECRET)}&${FOCUS}`, edge, ctx)
      await ctx.flush()
      await get(deps, `q=${encodeURIComponent(SECRET)}&${FOCUS}`, edge, ctx)
    }
    const throwing = fakeEdge()
    throwing.match = () => Promise.reject(new Error(`match ${SECRET}`))
    await get(harness(), `q=${encodeURIComponent(SECRET)}&${FOCUS}`, throwing)

    const logged = spies.flatMap((s) => s.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' ')))
    expect(logged.length).toBeGreaterThan(5)
    for (const line of logged) {
      expect(line).not.toMatch(/zqxsecret|40\.71|-74\.00/)
    }
    expect(logged.some((l) => l.includes('geocode-miss'))).toBe(true)
    expect(logged.some((l) => l.includes('geocode-edge-put-failed'))).toBe(true)
    expect(logged.some((l) => l.includes('geocode-internal'))).toBe(true)
  })
})
