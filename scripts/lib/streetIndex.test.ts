import { describe, expect, it } from 'vitest'
import type { Station } from '../../src/data/schema.ts'
import type { IntersectionEntry, StreetEntry } from './streetIndexTypes.ts'
import { toGround, toLatLon } from '../../src/lib/projection.ts'
import { STREET_INDEX_FORMAT } from '../../worker/src/streetIndexSchema.ts'
import { entryKeys } from '../../worker/src/streetKeys.ts'
import { buildStreetIndex, displayStreetName, INTERSECTION_MERGE_M } from './streetIndex.ts'
import { packStreetIndex, STREET_ATTRIBUTION } from './streetIndexPack.ts'
import { toStableJson } from './stableJson.ts'
import { pinOf, STATION, way, type NodeMeters } from './streetsFixture.ts'

const BROOKLYN_AT = { x: 3000, z: 0 }
const BROOKLYN: Station = { ...STATION, id: 'B01', name: 'Bk Test', ...toLatLon(BROOKLYN_AT, STATION), borough: 'Bk' }

const streetsOf = (entries: ReturnType<typeof buildStreetIndex>['entries']): StreetEntry[] => entries.filter((e): e is StreetEntry => e.kind === 'street')
const crossingsOf = (entries: ReturnType<typeof buildStreetIndex>['entries']): IntersectionEntry[] =>
  entries.filter((e): e is IntersectionEntry => e.kind === 'intersection')
/** Meters between a site and a point given in meters from STATION. */
const metersFrom = (site: readonly [number, number, string], at: { x: number; z: number }): number => {
  const a = toGround({ lat: site[0], lon: site[1] })
  const b = toGround(toLatLon(at, STATION))
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('displayStreetName', () => {
  it.each([
    ['North 7th Street', 'N 7 St'],
    ['N 7th St', 'N 7 St'],
    ['West 40th Street', 'W 40 St'],
    ['East 14th Street', 'E 14 St'],
    ['14th Street', '14 St'],
    ['Bedford Avenue', 'Bedford Av'],
    ['Ocean Parkway', 'Ocean Pkwy'],
    ['Atlantic Boulevard', 'Atlantic Blvd'],
    ['Avenue U', 'Av U'],
    ['Avenue 8', 'Av 8'],
    ['5th Avenue', '5 Av'],
    ['Saint Marks Place', 'St Marks Pl'],
    ['Bedford Park Boulevard West', 'Bedford Park Blvd W'],
    ['Ocean Avenue North', 'Ocean Av N'],
    ['Park Avenue South', 'Park Av S'],
    ['Broadway North', 'Broadway North'],
    ['Eastern Parkway Extension', 'Eastern Parkway Extension'],
    ['Brooklyn Bridge', 'Brooklyn Bridge'],
    ['West Street', 'West St'],
    ['West End Avenue', 'West End Av'],
    ['East Broadway', 'East Broadway'],
    ['Avenue of the Americas', 'Avenue of the Americas'],
    ['Lafayette Court', 'Lafayette Court'],
    ['Broadway', 'Broadway'],
  ])('%j is %j', (name, display) => {
    expect(displayStreetName(name)).toBe(display)
  })
})

describe('buildStreetIndex', () => {
  it('gives a street that crosses two boroughs a record in each, with its own site', () => {
    const nodes: NodeMeters = { 1: [0, 30], 2: [1000, 30], 3: [2000, 30], 4: [3000, 30] }
    const pin = pinOf(nodes, [way(1, { highway: 'primary', name: 'Broadway' }, [1, 2, 3, 4])])
    const { entries, stats } = buildStreetIndex(pin, [STATION, BROOKLYN])
    const streets = streetsOf(entries)
    expect(streets.map((s) => [s.name, s.borough])).toEqual([['Broadway', 'Bk'], ['Broadway', 'M']])
    const [bk, m] = streets
    expect(bk!.sites.map((s) => s[2])).toEqual(['B01'])
    expect(m!.sites.map((s) => s[2])).toEqual(['T01'])
    expect(metersFrom(m!.sites[0]!, { x: 0, z: 30 })).toBeLessThan(2)
    expect(metersFrom(bk!.sites[0]!, BROOKLYN_AT)).toBeLessThan(35)
    expect(stats.multiBoroughKeys).toBe(1)
  })

  it('merges spellings of one street into one record named by the short form', () => {
    const nodes: NodeMeters = { 1: [-100, 0], 2: [0, 0], 3: [100, 0], 4: [100, 50], 5: [200, 50] }
    const pin = pinOf(nodes, [
      way(1, { highway: 'residential', name: 'North 7th Street' }, [1, 2, 3]),
      way(2, { highway: 'residential', name: 'N 7th St' }, [4, 5]),
    ])
    const streets = streetsOf(buildStreetIndex(pin, [STATION]).entries)
    expect(streets.map((s) => s.name)).toEqual(['N 7 St'])
  })

  it('puts two streets at a shared node into one intersection, the higher class named first, at the lower class', () => {
    const nodes: NodeMeters = { 1: [0, -100], 2: [0, 0], 3: [0, 100], 4: [-100, 0], 5: [100, 0] }
    const pin = pinOf(nodes, [
      way(1, { highway: 'secondary', name: 'Bedford Avenue' }, [1, 2, 3]),
      way(2, { highway: 'residential', name: 'North 7th Street' }, [4, 2, 5]),
    ])
    const { entries, stats } = buildStreetIndex(pin, [STATION])
    const [x, ...rest] = crossingsOf(entries)
    expect(rest).toEqual([])
    expect(x!.names).toEqual(['Bedford Av', 'N 7 St'])
    expect([x!.borough, x!.rank, x!.site[2]]).toEqual(['M', 1, 'T01'])
    expect(metersFrom(x!.site, { x: 0, z: 0 })).toBeLessThan(1.5)
    expect(streetsOf(entries).map((s) => [s.name, s.rank])).toEqual([['Bedford Av', 3], ['N 7 St', 1]])
    expect(stats.intersections).toBe(1)
  })

  it('names two streets of equal class by name order', () => {
    const nodes: NodeMeters = { 1: [0, -100], 2: [0, 0], 3: [0, 100], 4: [-100, 0], 5: [100, 0] }
    const pin = pinOf(nodes, [
      way(1, { highway: 'residential', name: 'Wythe Avenue' }, [1, 2, 3]),
      way(2, { highway: 'residential', name: 'Berry Street' }, [4, 2, 5]),
    ])
    expect(crossingsOf(buildStreetIndex(pin, [STATION]).entries)[0]!.names).toEqual(['Berry St', 'Wythe Av'])
  })

  it('merges a second carriageway crossing 20 m away into one intersection at the node nearest the mean, and keeps one 150 m away apart', () => {
    const cross = (gap: number) => {
      const nodes: NodeMeters = { 1: [0, -100], 2: [0, 0], 3: [0, 100], 4: [gap, -100], 5: [gap, 0], 6: [gap, 100], 7: [-100, 0], 8: [gap + 100, 0] }
      return pinOf(nodes, [
        way(1, { highway: 'secondary', name: 'Bedford Avenue' }, [1, 2, 3]),
        way(2, { highway: 'secondary', name: 'Bedford Avenue' }, [4, 5, 6]),
        way(3, { highway: 'residential', name: 'North 7th Street' }, [7, 2, 5, 8]),
      ])
    }
    expect(INTERSECTION_MERGE_M).toBe(100)
    const near = crossingsOf(buildStreetIndex(cross(20), [STATION]).entries)
    expect(near).toHaveLength(1)
    // The two crossing nodes (0, 0) and (20, 0) are equally near the mean; the lower node id wins.
    expect(metersFrom(near[0]!.site, { x: 0, z: 0 })).toBeLessThan(1.5)
    expect(crossingsOf(buildStreetIndex(cross(150), [STATION]).entries)).toHaveLength(2)
  })

  it('makes no intersection of same-key ways, an unnamed or footway end, a plaza, or ways that cross with no shared node', () => {
    const nodes: NodeMeters = {
      1: [0, -100], 2: [0, 0], 3: [0, 100],
      4: [-100, 0], 5: [100, 0],
      6: [-50, -50], 7: [50, -50], 8: [50, 50], 9: [-50, 50],
      10: [-100, 20], 11: [100, 20],
    }
    const pin = pinOf(nodes, [
      way(1, { highway: 'residential', name: 'Main Street' }, [1, 2, 3]),
      way(2, { highway: 'residential', name: 'Main St' }, [4, 2, 5]),
      way(3, { highway: 'residential' }, [4, 2]),
      way(4, { highway: 'footway', name: 'Cross Path' }, [4, 2]),
      way(5, { highway: 'pedestrian', name: 'Union Square' }, [6, 7, 8, 9, 6]),
      way(6, { highway: 'residential', name: 'Elm Street' }, [10, 11]),
    ])
    const { entries } = buildStreetIndex(pin, [STATION])
    expect(crossingsOf(entries)).toEqual([])
    expect(streetsOf(entries).map((s) => s.name)).toEqual(['Elm St', 'Main St'])
  })

  it('puts a site at the nearest point of the segment, not the nearest vertex', () => {
    const pin = pinOf({ 1: [-500, 50], 2: [500, 50] }, [way(1, { highway: 'residential', name: 'Long Street' }, [1, 2])])
    const [street] = streetsOf(buildStreetIndex(pin, [STATION]).entries)
    expect(street!.sites).toHaveLength(1)
    expect(metersFrom(street!.sites[0]!, { x: 0, z: 50 })).toBeLessThan(1.5)
  })

  it('ranks a street by its best class', () => {
    const nodes: NodeMeters = { 1: [0, 0], 2: [100, 0], 3: [200, 0], 4: [0, 50], 5: [100, 50] }
    const pin = pinOf(nodes, [
      way(1, { highway: 'residential', name: 'Main Street' }, [1, 2]),
      way(2, { highway: 'primary_link', name: 'Main Street' }, [2, 3]),
      way(3, { highway: 'service', name: 'Back Lane' }, [4, 5]),
    ])
    expect(streetsOf(buildStreetIndex(pin, [STATION]).entries).map((s) => [s.name, s.rank])).toEqual([['Back Ln', 0], ['Main St', 4]])
  })

  it('builds the same entries twice', () => {
    const nodes: NodeMeters = { 1: [0, -100], 2: [0, 0], 3: [0, 100], 4: [-100, 0], 5: [100, 0] }
    const pin = pinOf(nodes, [way(1, { highway: 'secondary', name: 'Bedford Avenue' }, [1, 2, 3]), way(2, { highway: 'residential', name: 'North 7th Street' }, [4, 2, 5])])
    expect(JSON.stringify(buildStreetIndex(pin, [STATION]).entries)).toBe(JSON.stringify(buildStreetIndex(pin, [STATION]).entries))
  })
})

describe('packStreetIndex', () => {
  const nodes: NodeMeters = { 1: [0, -100], 2: [0, 0], 3: [0, 100], 4: [-100, 0], 5: [100, 0] }
  const pin = pinOf(nodes, [way(1, { highway: 'secondary', name: 'Bedford Avenue' }, [1, 2, 3]), way(2, { highway: 'residential', name: 'North 7th Street' }, [4, 2, 5])])
  const { entries } = buildStreetIndex(pin, [STATION])
  const file = packStreetIndex(entries, '2026-01-01T00:00:00Z')

  it('writes the envelope, the streets without their station ids, and the crossing by street index', () => {
    expect([file.format, file.license, file.attribution, file.osmTimestamp]).toEqual([STREET_INDEX_FORMAT, 'ODbL-1.0', STREET_ATTRIBUTION, '2026-01-01T00:00:00Z'])
    expect(file.streets.map((s) => [s[0], s[1], s[2], s[3].length])).toEqual([['Bedford Av', 'M', 3, 1], ['N 7 St', 'M', 1, 1]])
    expect(file.streets.every((s) => s[3].every((site) => site.length === 2))).toBe(true)
    expect(file.intersections).toHaveLength(1)
    expect(file.intersections[0]!.slice(0, 2)).toEqual([0, 1])
    expect(file.intersections[0]![2]).toHaveLength(2)
  })

  it('files each street under its keys only, sorted, each street once per key', () => {
    const want = new Map<string, number[]>()
    file.streets.forEach(([name], i) => entryKeys([name]).forEach((k) => want.set(k, [...(want.get(k) ?? []), i])))
    expect(file.keys).toEqual([...want].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  })

  it('drops a repeated site, and refuses a name with ", " or an intersection naming no street', () => {
    const street = entries.find((e): e is StreetEntry => e.kind === 'street')!
    const twice = packStreetIndex([{ ...street, sites: [street.sites[0]!, street.sites[0]!] }], 't')
    expect(twice.streets[0]![3]).toHaveLength(1)
    expect(() => packStreetIndex([{ ...street, name: 'A, B' }], 't')).toThrow(/contains ", "/)
    expect(() => packStreetIndex(entries.filter((e) => e.kind === 'intersection'), 't')).toThrow(/names a street with no row/)
  })

  it('renders the same JSON twice', () => {
    expect(toStableJson(file, 2)).toBe(toStableJson(packStreetIndex(entries, '2026-01-01T00:00:00Z'), 2))
  })
})
