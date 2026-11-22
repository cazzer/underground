import { describe, expect, it } from 'vitest'
import type { StreetWay } from '../../src/data/streetSchema.ts'
import { toLatLon } from '../../src/lib/projection.ts'
import { buildEntrances, entrancesByStation, median, parseEntranceRows, type EntranceInput, type FileStreets } from './streetsEntrances.ts'
import { STATION } from './streetsFixture.ts'

type P = readonly [number, number]

/** A street file from ways given as meter polylines (stored as decimeters). */
function fileOf(specs: readonly { id: number; name: string; points: P[]; tags?: Record<string, string> }[]): FileStreets {
  const x: number[] = []
  const z: number[] = []
  const ways: StreetWay[] = specs.map((s) => ({
    id: s.id,
    highway: 'residential',
    name: s.name,
    oneway: 0,
    nodes: s.points.map((p) => {
      x.push(Math.round(p[0] * 10))
      z.push(Math.round(p[1] * 10))
      return x.length - 1
    }),
  }))
  return { ways, x, z, tags: new Map(specs.map((s) => [s.id, { highway: 'residential', name: s.name, ...s.tags }])) }
}

const row = (p: P, over: Partial<EntranceInput> = {}): EntranceInput => {
  const ll = toLatLon({ x: p[0], z: p[1] }, STATION)
  return { type: 'Stair', entry: true, exit: true, lat: ll.lat, lon: ll.lon, gtfsStopIds: ['T01'], ...over }
}

const horizontal = (id: number, name: string, z: number, tags?: Record<string, string>) => ({ id, name, points: [[-150, z], [150, z]] as P[], tags })

describe('parseEntranceRows and entrancesByStation', () => {
  const json = { rows: [{ type: 'Stair', entry: true, exit: false, lat: 40.7, lon: -74, gtfsStopIds: ['A1', 'B2'], stationId: '1', complexId: '1' }] }

  it('reads the catalog rows and gives a two-stop row to both stations', () => {
    const rows = parseEntranceRows(json)
    expect(rows[0]).toMatchObject({ type: 'Stair', exit: false, gtfsStopIds: ['A1', 'B2'] })
    const by = entrancesByStation(rows)
    expect(by.get('A1')).toHaveLength(1)
    expect(by.get('B2')).toHaveLength(1)
    expect(by.get('C3')).toBeUndefined()
  })

  it('names the bad field of a malformed row', () => {
    expect(() => parseEntranceRows({ rows: [{ ...json.rows[0], lat: 'x' }] })).toThrow(/rows\[0\]\.lat/)
  })
})

describe('buildEntrances', () => {
  it('sorts by x, then z, then type, and sorts the stop ids', () => {
    const file = fileOf([horizontal(1, 'Main St', 0)])
    const { entrances } = buildEntrances(
      STATION,
      [row([20, 5], { type: 'Stair' }), row([-10, 5], { type: 'Stair' }), row([20, 5], { type: 'Elevator', gtfsStopIds: ['T01', 'A00'] }), row([20, -5])],
      file,
    )
    expect(entrances.map((e) => [e.x, e.z, e.type])).toEqual([[-100, 50, 'Stair'], [200, -50, 'Stair'], [200, 50, 'Elevator'], [200, 50, 'Stair']])
    expect(entrances[2]!.stopIds).toEqual(['A00', 'T01'])
    expect(entrances[0]).toMatchObject({ street: 'Main St', wayId: 1, side: 'south' })
  })

  it('logs an entrance with no street within the join radius, and a station with no entrances', () => {
    const file = fileOf([horizontal(1, 'Main St', 200)])
    expect(buildEntrances(STATION, [row([0, 0])], file).log.map((l) => l.kind)).toEqual(['no-street'])
    expect(buildEntrances(STATION, [], file).log.map((l) => l.kind)).toEqual(['no-entrances'])
  })

  it('logs a near miss for a median: the same street 25 to 40 m away on the other side', () => {
    const near = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Wide Pkwy', 35)]))
    expect(near.entrances[0]!.side).toBe('south')
    expect(near.log).toHaveLength(1)
    expect(near.log[0]).toMatchObject({ kind: 'near-miss' })
    expect(near.log[0]!.gapM).toBeCloseTo(30, 0)
    const median = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Wide Pkwy', 20)]))
    expect(median.entrances[0]!.side).toBe('median')
    expect(median.log).toEqual([])
    const other = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Other St', 35)]))
    expect(other.log).toEqual([])
  })

  it('logs a join to a bridge or tunnel way with its layer, but not bridge=no', () => {
    const tunnel = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Under St', 0, { tunnel: 'yes', layer: '-1' })]))
    expect(tunnel.log[0]).toMatchObject({ kind: 'bridge-tunnel' })
    expect(tunnel.log[0]!.line).toContain('tunnel=yes layer=-1')
    const no = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Plain St', 0, { bridge: 'no' })]))
    expect(no.log).toEqual([])
  })

  it('logs an entrance near the edge of the pinned radius', () => {
    const file = fileOf([{ id: 1, name: 'Main St', points: [[-150, 0], [350, 0]] }])
    expect(buildEntrances(STATION, [row([100, 0])], file).log).toEqual([])
    expect(buildEntrances(STATION, [row([280, 5])], file).log.map((l) => l.kind)).toEqual(['far-entrance'])
  })
})

describe('median', () => {
  it('takes the middle of an odd list and the mean of the middle two', () => {
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(() => median([])).toThrow()
  })
})
