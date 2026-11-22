import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectStationStreets, loadStationStreets } from './loadStationStreets'
import type { StationStreets } from './streetSchema'

const URL = '/underground/data/streets/L08.json'

function valid(): StationStreets {
  return {
    stationId: 'L08',
    anchor: { lat: 40.717, lon: -73.957 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    nodeId: [10, 1],
    x: [0, 120],
    z: [0, -40],
    ways: [{ id: 5, highway: 'residential', name: 'Bedford Avenue', oneway: 0, nodes: [0, 1] }],
    entrances: [],
  }
}

describe('expectStationStreets', () => {
  it('returns a well-formed file unchanged', () => {
    const raw = valid()
    expect(expectStationStreets(raw, 'L08', URL)).toBe(raw)
  })

  it.each([
    ['null', null],
    ['a mismatched stationId', { ...valid(), stationId: 'L06' }],
    ['a non-finite anchor', { ...valid(), anchor: { lat: Number.NaN, lon: -73.9 } }],
    ['a missing anchor', { ...valid(), anchor: undefined }],
    ['another format', { ...valid(), format: 2 }],
    ['a short x column', { ...valid(), x: [0] }],
    ['a missing z column', { ...valid(), z: undefined }],
    ['a missing ways array', { ...valid(), ways: undefined }],
    ['a missing entrances array', { ...valid(), entrances: {} }],
  ])('throws, naming the url, for %s', (_, raw) => {
    expect(() => expectStationStreets(raw, 'L08', URL)).toThrow(`${URL}: not a street file for L08`)
  })
})

describe('loadStationStreets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches the street file under the base url', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(valid())))
    vi.stubGlobal('fetch', fetchMock)
    const file = await loadStationStreets('/underground/', 'L08')
    expect(file?.stationId).toBe('L08')
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.anything())
  })

  it('gives null with one warning for a station with no street file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadStationStreets('/underground/', 'L08')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(URL)
  })

  it('rejects on any other HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(loadStationStreets('/underground/', 'L08')).rejects.toThrow(`${URL}: HTTP 500`)
  })

  it('rejects a file for another station', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...valid(), stationId: 'L06' }))))
    await expect(loadStationStreets('/underground/', 'L08')).rejects.toThrow(`${URL}: not a street file for L08`)
  })
})
