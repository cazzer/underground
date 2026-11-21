import { describe, expect, it } from 'vitest'
import { epochToIso, parseServing, trimEntrances, trimEquipment, trimOverpassWays } from './stationSources.ts'

const entranceRow = (over: Record<string, unknown> = {}) => ({
  division: 'BMT', line: 'Canarsie', stop_name: 'Bedford Av', gtfs_stop_id: 'L08',
  entrance_type: 'Stair', entry_allowed: 'YES', exit_allowed: 'YES',
  entrance_latitude: '40.717778', entrance_longitude: '-73.9574692', ...over,
})

describe('trimEntrances', () => {
  it('converts numbers and booleans, keeps the raw type, and sorts by lat then lon', () => {
    const rows = trimEntrances([
      entranceRow({ entrance_latitude: '40.72', exit_allowed: 'NO' }),
      entranceRow({ entrance_type: 'Elevator', entrance_latitude: '40.71' }),
    ])
    expect(rows).toEqual([
      { type: 'Elevator', entry: true, exit: true, lat: 40.71, lon: -73.9574692 },
      { type: 'Stair', entry: true, exit: false, lat: 40.72, lon: -73.9574692 },
    ])
  })
  it('names the row index for a non-numeric latitude', () => {
    expect(() => trimEntrances([entranceRow(), entranceRow({ entrance_latitude: 'north' })])).toThrow(/entrances\[1\]\.entrance_latitude/)
  })
  it('rejects an unknown YES/NO value and a non-array body', () => {
    expect(() => trimEntrances([entranceRow({ entry_allowed: 'MAYBE' })])).toThrow(/entry_allowed/)
    expect(() => trimEntrances({ error: true })).toThrow(/expected an array/)
  })
})

const el358 = {
  equipment_code: 'EL358', elevator_or_escalator: 'Elevator', station_mrn: '120',
  x_coordinate: '40.717735', y_coordinate: '-73.95772',
  notes: 'mezzanine to platform for service in both directions',
}

describe('trimEquipment', () => {
  it('reads x_coordinate as latitude and y_coordinate as longitude, and notes as serving', () => {
    expect(trimEquipment([el358])).toEqual([
      { code: 'EL358', kind: 'elevator', lat: 40.717735, lon: -73.95772, serving: el358.notes },
    ])
  })
  it('maps Escalator and sorts by code', () => {
    const rows = trimEquipment([{ ...el358, equipment_code: 'ES2', elevator_or_escalator: 'Escalator' }, el358])
    expect(rows.map((r) => [r.code, r.kind])).toEqual([['EL358', 'elevator'], ['ES2', 'escalator']])
  })
  it('rejects an unknown kind and empty notes', () => {
    expect(() => trimEquipment([{ ...el358, elevator_or_escalator: 'Moving walkway' }])).toThrow(/elevator_or_escalator/)
    expect(() => trimEquipment([{ ...el358, notes: '' }])).toThrow(/notes/)
  })
})

describe('trimOverpassWays', () => {
  const way = {
    type: 'way', id: 7, version: 4, timestamp: '2025-05-01T00:00:00Z', user: 'someone', uid: 9,
    tags: { level: '-2', name: 'Bedford Av', railway: 'platform', wheelchair: 'yes' },
    geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }, { lat: 2, lon: 3 }, { lat: 1, lon: 2 }],
  }
  const response = (elements: unknown[]) => ({ osm3s: { timestamp_osm_base: '2026-11-21T02:44:19Z' }, elements })
  it('keeps version, timestamp, the wanted tags and the ring, and drops everything else', () => {
    expect(trimOverpassWays(response([way]), [7])).toEqual({
      baseTimestamp: '2026-11-21T02:44:19Z',
      ways: [{ id: 7, version: 4, timestamp: '2025-05-01T00:00:00Z', tags: { level: '-2', name: 'Bedford Av', railway: 'platform' }, ring: [[1, 2], [1, 3], [2, 3], [1, 2]] }],
    })
  })
  it('throws for a ring whose last point differs from its first', () => {
    const open = { ...way, geometry: way.geometry.slice(0, 3) }
    expect(() => trimOverpassWays(response([open]), [7])).toThrow(/expected a closed ring/)
  })
  it('throws for a missing way or a way without geometry', () => {
    expect(() => trimOverpassWays(response([way]), [8])).toThrow(/way 8/)
    expect(() => trimOverpassWays(response([{ ...way, geometry: undefined }]), [7])).toThrow(/way 7.*geometry/)
  })
})

describe('epochToIso', () => {
  it('converts epoch seconds and rejects non-numbers', () => {
    expect(epochToIso(1_700_000_000, 't')).toBe('2023-11-14T22:13:20.000Z')
    expect(() => epochToIso('soon', 't')).toThrow(/^t:/)
  })
})

describe('parseServing', () => {
  it.each([
    ['Bedford Av and N 7 St (NE corner) to mezzanine for service in both directions', 'street', 'mezzanine'],
    ['mezzanine to platform for service in both directions', 'mezzanine', 'platform'],
    ['E 14 St and Avenue A (SW corner) to Canarsie-bound platform', 'street', 'platform'],
    ['mezzanine (96 St & 2nd Ave) to platform for downtown service', 'mezzanine', 'platform'],
    ['platform to mezzanine for 94 St & 2nd Ave exit', 'platform', 'mezzanine'],
    ['95 St & 2nd Ave entrance (SW corner) to mezzanine for downtown service', 'street', 'mezzanine'],
  ])('%s', (text, from, to) => {
    expect(parseServing(text)).toMatchObject({ from, to })
  })
  it('flags "both directions"', () => {
    expect(parseServing('mezzanine to platform for service in both directions').bothDirections).toBe(true)
    expect(parseServing('platform to mezzanine for 94 St & 2nd Ave exit').bothDirections).toBe(false)
  })
  it('throws on more than one " to " (multi-landing machines)', () => {
    expect(() => parseServing('street to mezzanine to platform')).toThrow(/more than one " to "/)
  })
  it('throws without a separator', () => {
    expect(() => parseServing('elevator')).toThrow(/no " to "/)
  })
})
