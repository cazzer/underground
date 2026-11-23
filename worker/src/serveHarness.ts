import { afterEach, beforeEach, vi, type Mock } from 'vitest'
import type { EdgeCache } from './edgeCache'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import { noStreetRows, type SourceOutcome, type StreetRows } from './geocodeOutcome'
import type { GeocodeQuery } from './geocodeQuery'
import type { GeocodeResponse } from './schema'
import { createGeocodeState, serveGeocode, type GeocodeDeps } from './serveGeocode'

/** Shared by the serveGeocode tests; tests only. */
export const T0 = 1_800_000_000_000
export const ALLOWED = 'https://cazzer.github.io'

export const ok = (candidates: ReturnType<typeof geoSearchCandidates>): SourceOutcome => ({
  status: 'ok',
  results: { candidates, dropped: 0, outside: 0 },
  cacheStatus: null,
})
export const GS_PLACE = ok(geoSearchCandidates('barclays center'))
export const GS_ADDRESS = ok(geoSearchCandidates('120 broadway'))
export const GS_EMPTY = ok([])
export const PH_KATZ = ok(photonCandidates("katz's deli"))
export const FAILED: SourceOutcome = { status: 'failed', error: 'http-503' }

export function fakeEdge(): EdgeCache & { store: Map<string, Response> } {
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

export function fakeCtx(): { waitUntil(p: Promise<unknown>): void; flush(): Promise<void> } {
  const pending: Promise<unknown>[] = []
  return { waitUntil: (p) => void pending.push(p), flush: async () => void (await Promise.all(pending)) }
}

type Fetcher = Mock<(q: GeocodeQuery) => Promise<SourceOutcome>>
export interface Harness extends GeocodeDeps {
  fetchGeoSearch: Fetcher
  fetchPhoton: Fetcher
  searchStreets: Mock<(q: GeocodeQuery) => StreetRows>
}

export function harness(gs: SourceOutcome = GS_PLACE, ph: SourceOutcome = PH_KATZ, streets: StreetRows = noStreetRows()): Harness {
  return {
    fetchGeoSearch: vi.fn(async () => gs),
    fetchPhoton: vi.fn(async () => ph),
    searchStreets: vi.fn(() => streets),
    state: createGeocodeState(Date.now()),
  }
}

export const get = (
  deps: GeocodeDeps,
  qs: string,
  edge: EdgeCache = fakeEdge(),
  ctx = fakeCtx(),
  origin: string | null = ALLOWED,
) => serveGeocode(new Request(`https://w.example/geocode?${qs}`), ctx, origin, edge, deps)

export const bodyOf = async (res: Response) => JSON.parse(await res.text()) as GeocodeResponse

/** Registers a frozen clock at T0 (only Date is faked) and quiet console.log/error for each test. */
export function installFakeClock(): void {
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
}
