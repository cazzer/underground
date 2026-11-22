import { describe, expect, it } from 'vitest'
import type { StreetWay } from '../../src/data/streetSchema.ts'
import { toLatLon } from '../../src/lib/projection.ts'
import { buildEntrances, entrancesByStation, median, parseComplexOf, parseEntranceRows, type EntranceInput, type FileStreets } from './streetsEntrances.ts'
import { MEDIAN_MAX_M } from './entranceStreet.ts'
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

describe('entrancesByStation over a complex', () => {
  const at = (id: string, lat: number): EntranceInput => ({ type: 'Stair', entry: true, exit: true, lat, lon: -74, gtfsStopIds: [id] })
  const rows = [at('A1', 40.1), at('A1', 40.2), at('B2', 40.3), at('C3', 40.4), { ...at('A1', 40.5), gtfsStopIds: ['A1', 'B2'] }]
  const complexOf = parseComplexOf({
    rows: [
      { gtfsStopId: 'A1', complexId: '7' },
      { gtfsStopId: 'B2', complexId: '7' },
      { gtfsStopId: 'C3', complexId: '8' },
      { gtfsStopId: 'D4', complexId: '7' },
    ],
  })
  const lats = (by: Map<string, EntranceInput[]>, id: string) => by.get(id)?.map((r) => r.lat)

  it("reads each stop's complex from the catalog stations", () => {
    expect(complexOf.get('B2')).toBe('7')
    expect(complexOf.get('C3')).toBe('8')
    expect(() => parseComplexOf({ rows: [{ gtfsStopId: 'A1' }] })).toThrow(/rows\[0\]\.complexId/)
  })

  it("gives every member of a complex the complex's rows, each once, and a member with none of its own too", () => {
    const by = entrancesByStation(rows, complexOf)
    const whole = [40.1, 40.2, 40.3, 40.5]
    expect(lats(by, 'A1')).toEqual(whole)
    expect(lats(by, 'B2')).toEqual(whole)
    expect(lats(by, 'D4')).toEqual(whole)
  })

  it('leaves another complex alone, and keeps each row as the catalog lists it', () => {
    const by = entrancesByStation(rows, complexOf)
    expect(lats(by, 'C3')).toEqual([40.4])
    expect(by.get('B2')![0]!.gtfsStopIds).toEqual(['A1'])
  })

  it('without a complex map, or for a stop it lacks, groups by listed stop only', () => {
    const plain = entrancesByStation(rows)
    expect(lats(plain, 'A1')).toEqual([40.1, 40.2, 40.5])
    expect(lats(plain, 'B2')).toEqual([40.3, 40.5])
    expect(plain.get('D4')).toBeUndefined()
    const partial = entrancesByStation(rows, new Map([['C3', '8']]))
    expect(lats(partial, 'A1')).toEqual([40.1, 40.2, 40.5])
  })

  it("puts each member's positions around its own anchor", () => {
    const file = fileOf([horizontal(1, 'Main St', 0)])
    const r = row([20, 5])
    const here = buildEntrances(STATION, [r], file).entrances[0]!
    const other = { ...STATION, ...toLatLon({ x: 50, z: 0 }, STATION) }
    const there = buildEntrances(other, [r], file).entrances[0]!
    expect([here.x, here.z]).toEqual([200, 50])
    expect([there.x, there.z]).toEqual([-300, 50])
  })
})

describe('buildEntrances over a complex', () => {
  const file = fileOf([horizontal(1, 'Main St', 0)])

  it("drops a row shared from another member past the street radius, never one that lists the station", () => {
    const own = row([20, 5])
    const sharedNear = row([100, 5], { gtfsStopIds: ['T02'] })
    const sharedFar = row([310, 5], { gtfsStopIds: ['T02'] })
    const ownFar = row([320, 5], { gtfsStopIds: ['T01', 'T02'] })
    const { entrances, log } = buildEntrances(STATION, [own, sharedNear, sharedFar, ownFar], file)
    expect(entrances.map((e) => e.x)).toEqual([200, 1000, 3200])
    const dropped = log.filter((l) => l.kind === 'shared-dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.line).toContain('dropped 1 shared')
  })

  it('logs nothing when no shared row is far', () => {
    expect(buildEntrances(STATION, [row([20, 5]), row([30, 5], { gtfsStopIds: ['T02'] })], file).log.filter((l) => l.kind === 'shared-dropped')).toEqual([])
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

  it('logs a near miss for a median: the same street just past MEDIAN_MAX_M on the other side', () => {
    const near = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Wide Pkwy', 5 + MEDIAN_MAX_M + 2)]))
    expect(near.entrances[0]!.side).toBe('south')
    expect(near.log).toHaveLength(1)
    expect(near.log[0]).toMatchObject({ kind: 'near-miss' })
    expect(near.log[0]!.gapM).toBeCloseTo(MEDIAN_MAX_M + 2, 0)
    const median = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Wide Pkwy', 5 + MEDIAN_MAX_M - 2)]))
    expect(median.entrances[0]!.side).toBe('median')
    expect(median.log).toEqual([])
    const other = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Wide Pkwy', 0), horizontal(2, 'Other St', 5 + MEDIAN_MAX_M + 2)]))
    expect(other.log).toEqual([])
  })

  it('logs a join to a bridge or tunnel way with its layer, but not bridge=no', () => {
    const tunnel = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Under St', 0, { tunnel: 'yes', layer: '-1' })]))
    expect(tunnel.log[0]).toMatchObject({ kind: 'bridge-tunnel' })
    expect(tunnel.log[0]!.line).toContain('tunnel=yes layer=-1')
    const no = buildEntrances(STATION, [row([0, 5])], fileOf([horizontal(1, 'Plain St', 0, { bridge: 'no' })]))
    expect(no.log).toEqual([])
  })

  it('never joins an entrance to a building passage, though the way stays in the file', () => {
    const file = fileOf([horizontal(1, 'Fulton Street', 0, { tunnel: 'building_passage' }), horizontal(2, 'Other St', 30)])
    const { entrances, log } = buildEntrances(STATION, [row([0, 5])], file)
    expect(entrances[0]).toMatchObject({ street: 'Other St', wayId: 2 })
    expect(log.map((l) => l.kind)).not.toContain('bridge-tunnel')
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
