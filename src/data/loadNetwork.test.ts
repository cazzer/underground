import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectDataFile, expectDataRecord, expectStationDepths, loadNetwork, mergeStationDepths } from './loadNetwork'

const URL = '/underground/data/stations.json'

describe('expectDataFile', () => {
  it('returns a well-formed file unchanged', () => {
    const raw = { feedVersion: 'v1', stations: [] }
    expect(expectDataFile(raw, 'stations', URL)).toBe(raw)
  })

  it('throws, naming the url, for null', () => {
    expect(() => expectDataFile(null, 'stations', URL)).toThrow(`${URL}: not a stations file`)
  })

  it('throws without a string feedVersion', () => {
    expect(() => expectDataFile({ stations: [] }, 'stations', URL)).toThrow(URL)
    expect(() => expectDataFile({ feedVersion: 3, stations: [] }, 'stations', URL)).toThrow(URL)
  })

  it('throws when the key is not an array', () => {
    expect(() => expectDataFile({ feedVersion: 'v1', stations: {} }, 'stations', URL)).toThrow(URL)
    expect(() => expectDataFile({ feedVersion: 'v1', routes: [] }, 'stations', URL)).toThrow(URL)
  })
})

describe('expectDataRecord', () => {
  it('returns a file whose key holds an object', () => {
    const raw = { feedVersion: 'v1', segments: { 'a>b': 30 } }
    expect(expectDataRecord(raw, 'segments', URL)).toBe(raw)
  })

  it('throws, naming the url, for null, a missing key, an array, or a missing feedVersion', () => {
    for (const raw of [null, { feedVersion: 'v1' }, { feedVersion: 'v1', segments: [] }, { feedVersion: 'v1', segments: null }, { segments: {} }]) {
      expect(() => expectDataRecord(raw, 'segments', URL)).toThrow(`${URL}: not a segments file`)
    }
  })
})

describe('expectStationDepths', () => {
  const DEPTHS = '/underground/data/station-depths.json'
  it('returns an ODbL file with a stations array unchanged', () => {
    const raw = { license: 'ODbL-1.0', attribution: [], stations: [] }
    expect(expectStationDepths(raw, DEPTHS)).toBe(raw)
  })
  it('throws, naming the url, without the license or the stations array', () => {
    for (const raw of [null, [], { stations: [] }, { license: 'ODbL-1.0' }, { license: 'ODbL-1.0', stations: {} }]) {
      expect(() => expectStationDepths(raw, DEPTHS)).toThrow(`${DEPTHS}: not a station-depths file`)
    }
  })
})

describe('mergeStationDepths', () => {
  const station = (stationId: string, railY: number) => ({
    stationId,
    anchor: { lat: 40.7, lon: -73.9 },
    tracks: [{ stopId: `${stationId}N`, railY, ends: [[0, 0], [1, 0]] as [[number, number], [number, number]] }],
  })
  it('adds the new stations sorted by id, keeps the base entry for a shared one, and unions the credits', () => {
    const base = { license: 'ODbL-1.0' as const, attribution: ['© OpenStreetMap contributors'], stations: [station('L08', -10)] }
    const extra = { license: 'ODbL-1.0' as const, attribution: ['© OpenStreetMap contributors', 'MTA'], stations: [station('A01', 6), station('L08', -3)] }
    const { depths, shadowed } = mergeStationDepths(base, extra)
    expect(depths.stations.map((s) => [s.stationId, s.tracks[0]!.railY])).toEqual([['A01', 6], ['L08', -10]])
    expect(depths.attribution).toEqual(['© OpenStreetMap contributors', 'MTA'])
    expect(shadowed).toEqual(['L08'])
  })
})

const FILES: Record<string, unknown> = {
  'station-depths': { license: 'ODbL-1.0', attribution: [], stations: [] },
  'depths-generated': { license: 'ODbL-1.0', attribution: [], stations: [] },
  stations: {
    feedVersion: 'v1',
    stations: [{ id: '101', name: 'A', lat: 40.8, lon: -73.9, stops: [], routes: ['1'] }],
  },
  routes: { feedVersion: 'v1', routes: [{ id: '1', shortName: '1', longName: 'L', color: 'EE352E', textColor: 'FFFFFF' }] },
  shapes: { feedVersion: 'v1', shapes: [{ id: '1..N', routeId: '1', direction: 'N', primary: true, lat: [4070000, 10], lon: [-7400000, 10] }] },
}

/** Serves FILES by name; `override` replaces the response for one file. */
function stubFetch(override?: { name: string; respond: () => Response }) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const name = /\/([\w-]+)\.json$/.exec(url)![1]!
    if (override && override.name === name) return override.respond()
    return new Response(JSON.stringify(FILES[name]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('loadNetwork', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the four files without the browser cache and builds the network', async () => {
    const fetch = stubFetch()
    const { network, files } = await loadNetwork('/underground/', 0, 2, new AbortController().signal)
    expect(files.shapes.shapes).toHaveLength(1)
    expect(network.stations.map((s) => s.id)).toEqual(['101'])
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      '/underground/data/routes.json',
      '/underground/data/shapes.json',
      '/underground/data/station-depths.json',
      '/underground/data/stations.json',
    ])
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'no-cache' })
  })

  it('names the url and HTTP status on a failed response', async () => {
    stubFetch({ name: 'shapes', respond: () => new Response('nope', { status: 503 }) })
    await expect(loadNetwork('/underground/', 0, 2, new AbortController().signal)).rejects.toThrow(
      '/underground/data/shapes.json: HTTP 503',
    )
  })

  it('fails the load when station-depths.json is missing', async () => {
    stubFetch({ name: 'station-depths', respond: () => new Response('nope', { status: 404 }) })
    await expect(loadNetwork('/underground/', 0, 2, new AbortController().signal)).rejects.toThrow(
      '/underground/data/station-depths.json: HTTP 404',
    )
  })

  it('names the url on invalid JSON', async () => {
    stubFetch({ name: 'routes', respond: () => new Response('{not json', { status: 200 }) })
    await expect(loadNetwork('/underground/', 0, 2, new AbortController().signal)).rejects.toThrow(
      /^\/underground\/data\/routes\.json: invalid JSON/,
    )
  })

  it('fetches stations/depths-generated.json only with generatedDepths, and a failure there only logs', async () => {
    const plain = stubFetch()
    await loadNetwork('/underground/', 0, 2, new AbortController().signal)
    expect(plain.mock.calls.map(([url]) => url)).not.toContain('/underground/data/stations/depths-generated.json')
    const flagged = stubFetch()
    await loadNetwork('/underground/', 0, 2, new AbortController().signal, true)
    expect(flagged.mock.calls.map(([url]) => url)).toContain('/underground/data/stations/depths-generated.json')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ name: 'depths-generated', respond: () => new Response('nope', { status: 404 }) })
    const { network } = await loadNetwork('/underground/', 0, 2, new AbortController().signal, true)
    expect(network.stations).toHaveLength(1)
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('rejects with the AbortError when aborted', async () => {
    stubFetch()
    const controller = new AbortController()
    controller.abort()
    await expect(loadNetwork('/underground/', 0, 2, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
