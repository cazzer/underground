import { describe, expect, it, vi } from 'vitest'
import { noStreetRows } from './geocodeOutcome'
import { streetFixture } from './streetFixture'
import { searchStreets } from './streetSearch'
import { serveGeocode } from './serveGeocode'
import {
  ALLOWED,
  FAILED,
  GS_ADDRESS,
  GS_EMPTY,
  GS_PLACE,
  PH_KATZ,
  bodyOf,
  fakeCtx,
  fakeEdge,
  get,
  harness,
  installFakeClock,
  type Harness,
} from './serveHarness'

installFakeClock()

const index = streetFixture()
/** A harness whose street search is the real one over the fixture index. */
function withStreets(gs = GS_EMPTY, ph = PH_KATZ): Harness {
  const deps = harness(gs, ph)
  deps.searchStreets.mockImplementation((q) => searchStreets(index, q))
  return deps
}

describe('/geocode with the street index', () => {
  it('answers an intersection without calling either source, complete and cached', async () => {
    const deps = withStreets()
    const edge = fakeEdge()
    const ctx = fakeCtx()
    const res = await get(deps, 'q=bedford+av+%26+n+7+st', edge, ctx)
    await ctx.flush()
    const body = await bodyOf(res)
    expect(body).toMatchObject({
      version: 2,
      incomplete: false,
      attribution: { osm: '© OpenStreetMap contributors' },
      results: [{ label: 'Bedford Av & N 7 St, Brooklyn', kind: 'intersection', source: 'osm' }],
    })
    expect(deps.fetchGeoSearch).not.toHaveBeenCalled()
    expect(deps.fetchPhoton).not.toHaveBeenCalled()
    expect(edge.store.size).toBe(1)
    await get(deps, 'q=bedford+av+%26+n+7+st')
    expect(deps.searchStreets).toHaveBeenCalledTimes(1)
  })

  it('asks GeoSearch for a street hit but skips Photon, and lists the street first', async () => {
    const deps = withStreets(GS_PLACE)
    const body = await bodyOf(await get(deps, 'q=broadway'))
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(deps.fetchPhoton).not.toHaveBeenCalled()
    expect(body.results[0]).toMatchObject({ kind: 'street', source: 'osm' })
    expect(body.incomplete).toBe(false)
  })

  it('still asks Photon for a business query, street hit or not', async () => {
    const deps = withStreets()
    await get(deps, "q=Katz's+Deli")
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(deps.fetchPhoton).toHaveBeenCalledTimes(1)
  })

  it('keeps the street rows when both sources fail: 200, incomplete, not cached', async () => {
    const deps = withStreets(FAILED, FAILED)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    const res = await get(deps, 'q=bedford+av', edge, ctx)
    await ctx.flush()
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.incomplete).toBe(true)
    expect(body.results.map((r) => r.label)).toEqual(['Bedford Av, Brooklyn'])
    expect(edge.store.size).toBe(0)
  })

  it('puts the street index\'s whole-name rows before the upstream\'s, and its half-typed ones after', async () => {
    const whole = await bodyOf(await get(withStreets(GS_ADDRESS), 'q=broadway'))
    expect(whole.results.map((r) => r.source)).toEqual(['osm', 'osm', 'osm', 'geosearch', 'geosearch', 'geosearch'])
    const half = await bodyOf(await get(withStreets(GS_ADDRESS), 'q=bedford'))
    expect(half.results.map((r) => r.source)).toEqual(['geosearch', 'geosearch', 'geosearch', 'osm'])
  })

  it('behaves as before with no street rows', async () => {
    const deps = harness(GS_ADDRESS)
    deps.searchStreets.mockReturnValue(noStreetRows())
    const body = await bodyOf(await get(deps, 'q=120+Broadway'))
    expect(deps.fetchPhoton).not.toHaveBeenCalled()
    expect(body.results).toHaveLength(3)
    expect(body.results.every((r) => r.source === 'geosearch')).toBe(true)
  })

  it('never searches the index for a refused, malformed or rate-limited request', async () => {
    const deps = withStreets()
    expect((await get(deps, 'q=bedford+av', fakeEdge(), fakeCtx(), null)).status).toBe(403)
    expect((await get(deps, 'q=ab')).status).toBe(400)
    expect((await get(deps, 'q=abc&focus=1,2,3')).status).toBe(400)
    deps.clientLimit = { limit: async () => ({ success: false }) }
    const headers = { 'CF-Connecting-IP': '203.0.113.7' }
    const limited = await serveGeocode(new Request('https://w.example/geocode?q=bedford+av', { headers }), fakeCtx(), ALLOWED, fakeEdge(), deps)
    expect(limited.status).toBe(429)
    expect(deps.searchStreets).not.toHaveBeenCalled()
  })

  it('logs no query, label or focus for a street search', async () => {
    const deps = withStreets()
    await get(deps, 'q=bedford+av+%26+n+7+st&focus=40.71,-73.96')
    const lines = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('geocode-miss'))).toBe(true)
    for (const line of lines) expect(line).not.toMatch(/bedford|n 7|40\.71|-73\.96/i)
    expect(JSON.parse(lines.find((l) => l.includes('geocode-miss'))!)).toMatchObject({ results: 1, osm: 1 })
  })
})
