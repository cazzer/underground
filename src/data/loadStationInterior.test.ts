import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectStationInterior, loadStationInterior } from './loadStationInterior'

const URL = '/underground/data/stations/L08.json'

function valid(): Record<string, unknown> {
  return {
    stationId: 'L08',
    anchor: { lat: 40.7, lon: -73.9 },
    levels: [{ id: 'street', name: 'Street', kind: 'street', y: 0 }],
    platforms: [],
    slabs: [],
    connectors: [],
    entrances: [],
    fareLines: [],
  }
}

describe('expectStationInterior', () => {
  it('returns a well-formed file unchanged', () => {
    const raw = valid()
    expect(expectStationInterior(raw, 'L08', URL)).toBe(raw)
  })

  it.each([
    ['null', null],
    ['a mismatched stationId', { ...valid(), stationId: 'L06' }],
    ['a missing connectors array', { ...valid(), connectors: undefined }],
    ['empty levels', { ...valid(), levels: [] }],
    ['a non-finite anchor', { ...valid(), anchor: { lat: Number.NaN, lon: -73.9 } }],
    ['a string anchor', { ...valid(), anchor: { lat: '40.7', lon: -73.9 } }],
  ])('throws, naming the url, for %s', (_, raw) => {
    expect(() => expectStationInterior(raw, 'L08', URL)).toThrow(`${URL}: not a station interior for L08`)
  })
})

describe('loadStationInterior', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches the station file under the base url', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(valid())))
    vi.stubGlobal('fetch', fetchMock)
    const interior = await loadStationInterior('/underground/', 'L08')
    expect(interior.stationId).toBe('L08')
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.anything())
  })

  it('reports the HTTP status with the url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(loadStationInterior('/underground/', 'L08')).rejects.toThrow(`${URL}: HTTP 500`)
  })
})
