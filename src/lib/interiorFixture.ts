/** Mini station interior and buffer helpers shared by the interior geometry tests. */
import type { Connector, StationInterior } from '../data/stationSchema'
import type { Buffers, InteriorBufferOptions, InteriorRole } from './interiorGeometry'

export const ROLES: InteriorRole[] = ['outline', 'track', 'stair', 'elevator', 'entrance', 'step', 'guide', 'fare', 'escalator']

export const STAIR: Connector = {
  id: 'ST1',
  kind: 'stair',
  lower: { x: 0, z: 10, level: 'mezz' },
  upper: { x: 7, z: 10, level: 'street' },
  width: 2,
  sources: ['authored'],
}

export const ELEVATOR: Connector = {
  id: 'EL1',
  kind: 'elevator',
  lower: { x: 3, z: 0, level: 'plat' },
  upper: { x: 3, z: 0, level: 'mezz' },
  width: 2,
  sources: ['authored'],
}

export function fixture(connectors: Connector[] = [STAIR, ELEVATOR]): StationInterior {
  return {
    stationId: 'X01',
    name: 'Fixture',
    anchor: { lat: 40.7, lon: -73.9 },
    license: 'ODbL-1.0',
    attribution: [],
    levels: [
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
      { id: 'plat', name: 'Platform', kind: 'platform', y: -8 },
    ],
    platforms: [
      {
        id: 'P1',
        level: 'plat',
        outline: [
          [-20, -3],
          [20, -3],
          [20, 3],
          [-20, 3],
        ],
        tracks: [{ stopId: 'X01N', path: [[-25, -5], [25, -5]] }],
        osmRef: 'way/1',
        sources: ['osm'],
      },
    ],
    slabs: [
      {
        id: 'S1',
        level: 'mezz',
        name: 'Mezzanine',
        outline: [
          [-5, 5],
          [5, 5],
          [5, 15],
          [-5, 15],
        ],
        sources: ['authored'],
      },
    ],
    connectors,
    entrances: [
      { id: 'E1', x: 9, z: 10, type: 'Stair', entry: true, exit: true, connectors: ['ST1'], sources: ['nyopendata'] },
    ],
    fareLines: [],
  }
}

export const opts = (over: Partial<InteriorBufferOptions> = {}): InteriorBufferOptions => ({
  yScale: 2,
  stepRise: 0.18,
  railDrop: 1.1,
  entranceSize: 2.5,
  guides: true,
  colorOf: (role, i) => [ROLES.indexOf(role), i, 0],
  ...over,
})

export const count = (b: Buffers) => b.positions.length / 6
/** Segment k as [ax, ay, az, bx, by, bz]. */
export const seg = (b: Buffers, k: number) => Array.from(b.positions.subarray(k * 6, k * 6 + 6))
export const color = (b: Buffers, k: number) => Array.from(b.colors.subarray(k * 6, k * 6 + 3))
export const firstWith = (b: Buffers, role: InteriorRole, level: number) =>
  Array.from({ length: count(b) }, (_, k) => color(b, k)).findIndex((c) => c[0] === ROLES.indexOf(role) && c[1] === level)
