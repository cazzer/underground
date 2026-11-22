import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { overpassQuery, trimOverpassLines, trimOverpassNodes } from './stationOsmElements.ts'
import { trimEquipment } from './stationSources.ts'

const response = (elements: unknown[]) => ({ osm3s: { timestamp_osm_base: '2026-11-22T06:04:39Z' }, elements })
const step = {
  type: 'way', id: 11, version: 3, timestamp: '2025-05-01T00:00:00Z', user: 'someone',
  tags: { highway: 'steps', level: '-2;-1', step_count: '17', incline: 'up', description: 'P12', name: 'x' },
  geometry: [{ lat: 40.735, lon: -73.99 }, { lat: 40.7351, lon: -73.9901 }],
}
const elevator = {
  type: 'node', id: 22, version: 2, timestamp: '2025-06-01T00:00:00Z', lat: 40.7352, lon: -73.9899,
  tags: { highway: 'elevator', level: '0;-1', wheelchair: 'yes' },
}

describe('trimOverpassLines', () => {
  it('keeps an open way of two points with version, timestamp and the kept tags only', () => {
    expect(trimOverpassLines(response([step]), [11])).toEqual([{
      id: 11, version: 3, timestamp: '2025-05-01T00:00:00Z',
      tags: { highway: 'steps', level: '-2;-1', step_count: '17', incline: 'up' },
      points: [[40.735, -73.99], [40.7351, -73.9901]],
    }])
  })
  it('also keeps a closed way, in the order asked', () => {
    const ring = { ...step, id: 12, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }, { lat: 2, lon: 3 }, { lat: 1, lon: 2 }] }
    expect(trimOverpassLines(response([step, ring]), [12, 11]).map((l) => [l.id, l.points.length])).toEqual([[12, 4], [11, 2]])
  })
  it('names a missing way, a one-point way and a bad coordinate', () => {
    expect(() => trimOverpassLines(response([step]), [99])).toThrow(/way 99 not in the response/)
    expect(() => trimOverpassLines(response([{ ...step, geometry: [{ lat: 1, lon: 2 }] }]), [11])).toThrow(/way 11: expected at least 2 points/)
    expect(() => trimOverpassLines(response([{ ...step, geometry: [{ lat: 1, lon: 2 }, { lat: 'n', lon: 3 }] }]), [11])).toThrow(/way 11\.geometry\[1\]\.lat/)
  })
})

describe('trimOverpassNodes', () => {
  it('keeps the point, meta and the kept tags', () => {
    expect(trimOverpassNodes(response([elevator]), [22])).toEqual([
      { id: 22, version: 2, timestamp: '2025-06-01T00:00:00Z', tags: { highway: 'elevator', level: '0;-1' }, lat: 40.7352, lon: -73.9899 },
    ])
  })
  it('does not take a way for a node, and names a missing or malformed one', () => {
    expect(() => trimOverpassNodes(response([{ ...step, id: 22 }]), [22])).toThrow(/node 22 not in the response/)
    expect(() => trimOverpassNodes(response([{ ...elevator, lon: undefined }]), [22])).toThrow(/node 22\.lon/)
  })
})

describe('overpassQuery', () => {
  const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
  it("builds exactly the query L08's pinned sources were fetched with", () => {
    const authored = JSON.parse(read('data/stations/L08.authored.json')) as AuthoredStation
    const sources = JSON.parse(read('data/stations/L08.sources.json')) as StationSources
    expect(overpassQuery(authored.fetch)).toBe(sources.osm.query)
    expect(overpassQuery({ osmWays: [906963980] })).toBe('[out:json][timeout:60];way(id:906963980);out geom meta;')
  })
  it('asks for lines with the ways and for nodes in one union, only when given', () => {
    expect(overpassQuery({ osmWays: [1, 2], osmLines: [3, 4], osmNodes: [5] })).toBe('[out:json][timeout:60];(way(id:1,2,3,4);node(id:5););out geom meta;')
    expect(overpassQuery({ osmWays: [1], osmLines: [3] })).toBe('[out:json][timeout:60];(way(id:1,3););out geom meta;')
    expect(overpassQuery({ osmWays: [1], osmNodes: [5], osmLines: [] })).toBe('[out:json][timeout:60];(way(id:1);node(id:5););out geom meta;')
  })
})

describe('overpassQuery ids', () => {
  it('rejects an id that is not a positive safe integer, or no ways, naming the field', () => {
    expect(() => overpassQuery({ osmWays: [1], osmLines: ['1);node(around:5' as unknown as number] })).toThrow(/fetch\.osmLines\[0\]: expected a positive integer/)
    expect(() => overpassQuery({ osmWays: [1.5] })).toThrow(/fetch\.osmWays\[0\]/)
    expect(() => overpassQuery({ osmWays: [1], osmNodes: [5, -2] })).toThrow(/fetch\.osmNodes\[1\]/)
    expect(() => overpassQuery({ osmWays: [Number.MAX_SAFE_INTEGER + 2] })).toThrow(/fetch\.osmWays\[0\]/)
    expect(() => overpassQuery({ osmWays: [] })).toThrow(/fetch\.osmWays: expected at least one/)
  })
})

describe('trimEquipment notes', () => {
  const row = { equipment_code: 'EL217', elevator_or_escalator: 'Elevator', x_coordinate: '40.7', y_coordinate: '-74' }
  it('reads missing notes as a null serving, but still rejects empty or non-string ones', () => {
    expect(trimEquipment([row])[0]!.serving).toBeNull()
    expect(trimEquipment([{ ...row, notes: 'a to b' }])[0]!.serving).toBe('a to b')
    expect(() => trimEquipment([{ ...row, notes: '' }])).toThrow(/notes/)
    expect(() => trimEquipment([{ ...row, notes: 4 }])).toThrow(/notes/)
  })
})
