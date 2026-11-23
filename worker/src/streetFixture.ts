import { loadStreetIndex, type StreetIndex } from './streetIndex'
import { STREET_INDEX_FORMAT, type CrossingRow, type IndexSite, type StreetIndexFile, type StreetRow } from './streetIndexSchema.ts'
import { entryKeys } from './streetKeys.ts'

/** Tests only: a small street index. Indices below are positions in `STREETS`. */
const site = (lat: number, lon: number): IndexSite => [lat, lon]

export const STREETS: StreetRow[] = [
  ['Bedford Av', 'Bk', 3, [site(40.7178, -73.9577), site(40.6894, -73.9544)]], // 0
  ['N 7 St', 'Bk', 1, [site(40.7185, -73.9577)]], // 1
  ['Broadway', 'M', 4, [site(40.7127, -74.0066), site(40.7589, -73.9851), site(40.8, -73.97)]], // 2
  ['Broadway', 'Bk', 3, [site(40.7002, -73.9395)]], // 3
  ['Broadway', 'Q', 3, [site(40.7561, -73.9217)]], // 4
  ['W 40 St', 'M', 2, [site(40.7549, -73.9876)]], // 5
  ['W 4 St', 'M', 1, [site(40.7326, -74.0002)]], // 6
  ['N 6 St', 'Bk', 1, [site(40.7195, -73.9581)]], // 7
  ['G & H Av', 'Bk', 1, [site(40.6401, -73.9742)]], // 8
  ['Av U', 'Bk', 2, [site(40.5985, -73.9553)]], // 9
]

/** [first, second, site]: Bedford crosses N 7 St and N 6 St; Broadway (Manhattan) crosses W 40 St twice (two carriageways). */
export const CROSSINGS: CrossingRow[] = [
  [0, 1, site(40.71784, -73.95773)],
  [0, 7, site(40.7195, -73.9581)],
  [2, 5, site(40.7549, -73.9862)],
  [2, 5, site(40.7551, -73.9866)],
  [2, 6, site(40.7284, -73.9922)],
]

export function streetFixtureFile(): StreetIndexFile {
  const byKey = new Map<string, number[]>()
  STREETS.forEach(([name], i) => {
    for (const k of entryKeys([name])) byKey.set(k, [...(byKey.get(k) ?? []), i])
  })
  return {
    format: STREET_INDEX_FORMAT,
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    osmTimestamp: '2026-01-01T00:00:00Z',
    streets: STREETS,
    intersections: CROSSINGS,
    keys: [...byKey].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  }
}

export const streetFixture = (): StreetIndex => loadStreetIndex(streetFixtureFile())
