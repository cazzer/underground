import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetEntrance, StreetWay } from '../data/streetSchema'
import { entranceTexts, pairRank } from './entranceText'

function entrance(x: number, z: number, j: Partial<StreetEntrance>): StreetEntrance {
  return { x: x * 10, z: z * 10, type: 'Stair', entry: true, exit: true, stopIds: ['120'], street: null, wayId: null, cross: null, crossWayId: null, side: null, plaza: null, ...j }
}

function way(id: number, name: string, nodes: number[]): StreetWay {
  return { id, highway: 'primary', name, oneway: 0, nodes }
}

/** Broadway runs north-south on x = 0; W 94 St crosses it at z = -30 (north), W 93 St at z = 50. Meters. */
function file(entrances: StreetEntrance[]): StationStreets {
  const points: [number, number][] = [[0, -100], [0, 100], [-80, -30], [80, -30], [-80, 50], [80, 50]]
  return {
    stationId: '120',
    anchor: { lat: 40.79, lon: -73.97 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 150,
    nodeId: points.map((_, i) => (i === 0 ? 1 : 1)),
    x: points.map((p) => p[0] * 10),
    z: points.map((p) => p[1] * 10),
    ways: [way(1, 'Broadway', [0, 1]), way(2, 'West 94th Street', [2, 3]), way(3, 'West 93rd Street', [4, 5])],
    entrances,
  }
}

describe('entranceTexts', () => {
  it('names the nearest other street for an entrance with no cross street', () => {
    const [t] = entranceTexts(file([entrance(-10, -20, { street: 'Broadway', side: 'west' })]))
    expect(t!.text).toBe('Broadway · west side at W 94 St')
    expect(t!.head).toBe('Broadway')
    expect(t!.tail).toBe('west side at W 94 St')
    expect(t!.keys).toEqual(['broadway', 'w 94 st'])
  })

  it('leaves the nearby street out past 60 m', () => {
    const [t] = entranceTexts(file([entrance(-10, 120, { street: 'Broadway', side: 'west' })]))
    expect(t!.text).toBe('Broadway · west side')
  })

  it('tells two labels that would match apart by the side of the nearby street', () => {
    const texts = entranceTexts(
      file([entrance(-10, -40, { street: 'Broadway', side: 'west' }), entrance(-10, -20, { street: 'Broadway', side: 'west' })]),
    )
    expect(texts.map((t) => t.text)).toEqual(['Broadway · west side · north of W 94 St', 'Broadway · west side · south of W 94 St'])
    expect(texts.every((t) => t.unique)).toBe(true)
  })

  it('pairs streets in one order per station, avenue-type first', () => {
    const texts = entranceTexts(
      file([
        entrance(5, -35, { street: 'West 94th Street', cross: 'Broadway', side: 'SE' }),
        entrance(-5, -35, { street: 'Broadway', cross: 'West 94th Street', side: 'SW' }),
      ]),
    )
    expect(texts.map((t) => t.head)).toEqual(['Broadway & W 94 St', 'Broadway & W 94 St'])
  })

  it('merges one head house’s same-text stairs, flags far duplicates, keeps elevators apart, skips unlabelled', () => {
    const corner = { street: 'Broadway', cross: 'West 94th Street', side: 'SE' } as const
    const texts = entranceTexts(
      file([
        entrance(5, -35, corner),
        entrance(6, -36, { ...corner, type: 'Elevator' }),
        entrance(7, -37, corner),
        entrance(5, 40, corner),
        entrance(0, 0, {}),
      ]),
    )
    expect(texts.map((t) => [t.index, t.unique, t.elevator])).toEqual([
      [0, false, false],
      [1, true, true],
      [3, false, false],
    ])
    expect(texts.map((t) => t.headHouse)).toEqual([0, 0, 1])
    expect(texts.map((t) => t.count)).toEqual([2, 1, 1])
  })

  it('names both cross streets around a median entrance', () => {
    const [t] = entranceTexts(file([entrance(0, 10, { street: 'Broadway', side: 'median' })]))
    expect(t!.text).toBe('Broadway median between W 93 & W 94 St')
    expect(t!.keys).toEqual(['broadway', 'w 94 st', 'w 93 st'])
  })
})

describe('pairRank', () => {
  it('puts avenues before streets before the rest', () => {
    expect(pairRank('7th Avenue')).toBe(0)
    expect(pairRank('Broadway')).toBe(0)
    expect(pairRank('West 42nd Street')).toBe(1)
    expect(pairRank('Shubert Alley')).toBe(2)
  })
})

describe('entranceTexts on the committed street files', () => {
  for (const id of ['L08', '120', '127']) {
    it(`${id}: one order per street pair`, () => {
      const streets = JSON.parse(readFileSync(`public/data/streets/${id}.json`, 'utf8')) as StationStreets
      const seen = new Map<string, string>()
      for (const t of entranceTexts(streets)) {
        if (!t.head.includes(' & ')) continue
        const pair = t.head.split(' & ').sort().join('|')
        expect(seen.get(pair) ?? t.head, t.text).toBe(t.head)
        seen.set(pair, t.head)
      }
    })
  }

  it('96 St (120): every label reads differently', () => {
    const streets = JSON.parse(readFileSync('public/data/streets/120.json', 'utf8')) as StationStreets
    expect(entranceTexts(streets).every((t) => t.unique)).toBe(true)
  })
})
