import { describe, expect, it, vi } from 'vitest'
import { toGround } from '../lib/projection'
import { buildPolyline } from '../lib/realtime/polyline'
import type { AnchorShape } from '../lib/trackAnchors'
import { CENTRE_MATCH_M, decodeStationDepths, STATION_MATCH_M, type DepthsStation, type DepthsStations } from './depthsCodec'
import type { PackedDepthsFile } from './stationSchema'

const anchor = { lat: 40.72, lon: -73.95 }
const g = toGround(anchor)
/** Northbound runs east 2 m south of the station point, southbound runs west 2 m north of it; 2 km each. */
const shapes: AnchorShape[] = [
  { id: 'L..N', routeId: 'L', direction: 'N', line: buildPolyline([{ x: g.x - 1000, z: g.z + 2 }, { x: g.x + 1000, z: g.z + 2 }]) },
  { id: 'L..S', routeId: 'L', direction: 'S', line: buildPolyline([{ x: g.x + 1000, z: g.z - 2 }, { x: g.x - 1000, z: g.z - 2 }]) },
]
const other: DepthsStation = { id: 'A01', lat: 40.8, lon: -73.9, stops: ['A01N', 'A01S'], routes: ['A'] }
const station: DepthsStation = { id: 'L08', ...anchor, stops: ['L08N', 'L08S'], routes: ['L'] }
const FEED = 'fall-2026'
const stations: DepthsStations = { feedVersion: FEED, stations: [other, station] }

const file = (over: Partial<PackedDepthsFile> = {}): PackedDepthsFile => ({
  license: 'ODbL-1.0',
  attribution: ['© OpenStreetMap contributors'],
  format: 2,
  feedVersion: FEED,
  station: [1],
  y: [-102],
  a: [10],
  h: [80],
  da: [0],
  dh: [0],
  tracks: {},
  ...over,
})
const ends = (out: ReturnType<typeof decodeStationDepths>, stopId: string) =>
  out.depths.stations[0]!.tracks.find((t) => t.stopId === stopId)!.ends.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100])

describe('decodeStationDepths', () => {
  it('lays the N run at d + a ± h and mirrors the S run about the same point, ends local to the station point', () => {
    const out = decodeStationDepths(file(), stations, shapes)
    expect(out.missed).toEqual([])
    const [depth] = out.depths.stations
    expect(depth!.stationId).toBe('L08')
    expect(depth!.anchor).toEqual(anchor)
    expect(depth!.tracks.map((t) => [t.stopId, t.railY])).toEqual([['L08N', -10.2], ['L08S', -10.2]])
    expect(ends(out, 'L08N')).toEqual([[-70, 2], [90, 2]])
    expect(ends(out, 'L08S')).toEqual([[90, -2], [-70, -2]])
    expect(out.depths.attribution).toEqual(['© OpenStreetMap contributors'])
  })

  it('shifts and stretches only the S track by da and dh', () => {
    const out = decodeStationDepths(file({ da: [5], dh: [-10] }), stations, shapes)
    expect(ends(out, 'L08N')).toEqual([[-70, 2], [90, 2]])
    // S centre at d - a + da = 995 along a westward line from x + 1000: x = 5; half-length 70.
    expect(ends(out, 'L08S')).toEqual([[75, -2], [-65, -2]])
  })

  it("reads stations by index delta in stations.json's order", () => {
    const out = decodeStationDepths(file({ station: [0, 1], y: [79, -102], a: [0, 10], h: [10, 80], da: [0, 0], dh: [0, 0] }), stations, [])
    expect(out.depths.stations.map((s) => s.stationId)).toEqual(['A01', 'L08'])
  })

  it('uses an override centre and height for its stop, and null for no track', () => {
    const out = decodeStationDepths(file({ tracks: { L08N: [-56, 30, 0, 20], L08S: null } }), stations, shapes)
    expect(out.depths.stations[0]!.tracks.map((t) => [t.stopId, t.railY])).toEqual([['L08N', -5.6]])
    expect(ends(out, 'L08N')).toEqual([[10, 2], [50, 2]])
  })

  it('reports a stop as missed when no line of its route and direction is in reach', () => {
    expect(decodeStationDepths(file(), stations, [shapes[0]!]).missed).toEqual(['L08S'])
    expect(decodeStationDepths(file(), stations, shapes.map((s) => ({ ...s, routeId: 'G' }))).missed).toEqual(['L08N', 'L08S'])
    const far: DepthsStation = { ...station, ...{ lat: anchor.lat + (STATION_MATCH_M + 10) / 111_000 } }
    expect(decodeStationDepths(file(), { feedVersion: FEED, stations: [other, far] }, shapes).missed).toEqual(['L08N', 'L08S'])
    const offCentre = decodeStationDepths(file({ tracks: { L08N: [-102, 0, CENTRE_MATCH_M + 5, 20] } }), stations, shapes)
    expect(offCentre.missed).toEqual(['L08N'])
  })

  it('throws on columns of different lengths, an index outside stations.json, or an override of no listed station', () => {
    expect(() => decodeStationDepths(file({ h: [] }), stations, shapes)).toThrow(/column h has 0 entries, not 1/)
    expect(() => decodeStationDepths(file({ station: [2] }), stations, shapes)).toThrow(/index 2 is outside stations.json/)
    expect(() => decodeStationDepths(file({ tracks: { A01N: null } }), stations, shapes)).toThrow(/A01N/)
  })

  const bad = (over: Record<string, unknown>) => file(over as Partial<PackedDepthsFile>)
  it.each([
    ['a non-integer index', bad({ station: [0.5] }), /station entry 0 is not an integer/],
    ['a negative first index', bad({ station: [-1] }), /first station index -1 is negative/],
    ['a later delta below 1', bad({ station: [1, 0], y: [0, 0], a: [0, 0], h: [0, 0], da: [0, 0], dh: [0, 0] }), /station delta 0 at entry 1 is below 1/],
    ['an index past the station count', bad({ station: [0, 2], y: [0, 0], a: [0, 0], h: [0, 0], da: [0, 0], dh: [0, 0] }), /index 2 is outside stations.json \(2 stations\)/],
    ['a non-number column value', bad({ a: ['10'] }), /column a entry 0 is not a number/],
    ['a null column value', bad({ dh: [null] }), /column dh entry 0 is not a number/],
    ['an override of three values', bad({ tracks: { L08N: [-102, 0, 0] } }), /override L08N is not four numbers/],
    ['an override of five values', bad({ tracks: { L08N: [-102, 0, 0, 20, 1] } }), /override L08N is not four numbers/],
    ['an override with a string', bad({ tracks: { L08N: [-102, 0, '0', 20] } }), /override L08N is not four numbers/],
  ])('throws on %s', (_name, f, message) => {
    expect(() => decodeStationDepths(f, stations, shapes)).toThrow(message)
  })

  it('logs one error and decodes no depths, never throwing, when packed for another stations.json', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Even a file that would otherwise be malformed: the stale index is the first thing wrong with it.
    for (const f of [file({ feedVersion: 'spring-2026' }), bad({ feedVersion: 'spring-2026', station: [9] })]) {
      const out = decodeStationDepths(f, stations, shapes)
      expect(out.depths.stations).toEqual([])
      expect(out.missed).toEqual([])
    }
    expect(error).toHaveBeenCalledTimes(2)
    expect(String(error.mock.calls[0]![0])).toMatch(/"spring-2026", not stations.json's "fall-2026"/)
    error.mockRestore()
  })
})
