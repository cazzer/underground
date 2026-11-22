/**
 * Synthetic two-station complex, the transfer and path tests' interior (station ids as scripts/lib/complexFixture.ts).
 * Interior-local meters (x east, z south). Two platform decks under one mezzanine level:
 * - island-t (level platform-t, y -9): x -30..30, z -3..3; tracks T01N z -2.5, T01S z 2.5, x -40..40.
 * - island-u (level platform-u, y -14): x -30..30, z 10..16; tracks U01N z 10.5, U01S z 15.5.
 * - mezz-t (mezz, y -4): x -30..-10, z -20..0; mezz-u: x -30..-10, z 14..35; both paid.
 * Connectors: the direct stair st-tu (island-u at (20, 11) up to island-t at (20, 2)); platform stairs st-t, st-u;
 * elevators EL-T, EL-U (platform to mezzanine); walkway wk-tu between the mezzanines; street stairs st-street-t and
 * st-street-u and the street elevator EL-S, each at its own entrance.
 */
import type { Connector, Slab, StationInterior } from '../data/stationSchema'

const sources: Connector['sources'] = ['authored']
type End = [x: number, z: number, level: string, area?: string]

export function connector(id: string, kind: Connector['kind'], lower: End, upper: End, over: Partial<Connector> = {}): Connector {
  const end = ([x, z, level, area]: End) => (area === undefined ? { x, z, level } : { x, z, level, area })
  return { id, kind, lower: end(lower), upper: end(upper), width: kind === 'elevator' ? 2 : 2.4, sources, ...over }
}

const rect = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]

export const ST_TU = connector('st-tu', 'stair', [20, 11, 'platform-u', 'island-u'], [20, 2, 'platform-t', 'island-t'])

const CONNECTORS: Connector[] = [
  connector('EL-S', 'elevator', [-28, -18, 'mezz', 'mezz-t'], [-28, -18, 'street']),
  connector('EL-T', 'elevator', [-25, -1, 'platform-t'], [-25, -1, 'mezz']),
  connector('EL-U', 'elevator', [-25, 15, 'platform-u'], [-25, 15, 'mezz']),
  ST_TU,
  connector('st-street-t', 'stair', [-12, -18, 'mezz', 'mezz-t'], [-12, -25, 'street']),
  connector('st-street-u', 'stair', [-12, 33, 'mezz', 'mezz-u'], [-12, 40, 'street']),
  connector('st-t', 'stair', [-15, -2, 'platform-t', 'island-t'], [-15, -8, 'mezz', 'mezz-t']),
  connector('st-u', 'stair', [-15, 15, 'platform-u', 'island-u'], [-15, 22, 'mezz', 'mezz-u']),
  connector('wk-tu', 'walkway', [-20, 0, 'mezz', 'mezz-t'], [-20, 14, 'mezz', 'mezz-u'], { width: 4 }),
]

export function complexFixture(): StationInterior {
  return {
    stationId: 'T01',
    memberStationIds: ['T01', 'U01'],
    name: 'Test Complex',
    anchor: { lat: 40.7, lon: -73.9 },
    license: 'ODbL-1.0',
    attribution: [],
    levels: [
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
      { id: 'platform-t', name: 'T platform', kind: 'platform', y: -9 },
      { id: 'platform-u', name: 'U platform', kind: 'platform', y: -14 },
    ],
    platforms: [
      {
        id: 'island-t',
        level: 'platform-t',
        outline: rect(-30, 30, -3, 3),
        tracks: [
          { stopId: 'T01N', path: [[-40, -2.5], [40, -2.5]] },
          { stopId: 'T01S', path: [[-40, 2.5], [40, 2.5]] },
        ],
        osmRef: 'way/1',
        sources: ['osm'],
      },
      {
        id: 'island-u',
        level: 'platform-u',
        outline: rect(-30, 30, 10, 16),
        tracks: [
          { stopId: 'U01N', path: [[-40, 10.5], [40, 10.5]] },
          { stopId: 'U01S', path: [[-40, 15.5], [40, 15.5]] },
        ],
        osmRef: 'way/2',
        sources: ['osm'],
      },
    ],
    slabs: [
      { id: 'mezz-t', level: 'mezz', name: 'T mezzanine', outline: rect(-30, -10, -20, 0), paid: true, sources },
      { id: 'mezz-u', level: 'mezz', name: 'U mezzanine', outline: rect(-30, -10, 14, 35), paid: true, sources },
    ],
    connectors: CONNECTORS,
    entrances: [
      { id: 'ent-el', x: -28, z: -18, type: 'Elevator', entry: true, exit: true, connectors: ['EL-S'], sources: ['nyopendata'] },
      { id: 'ent-t', x: -12, z: -26, type: 'Stair', entry: true, exit: true, connectors: ['st-street-t'], sources: ['nyopendata'] },
      { id: 'ent-u', x: -12, z: 41, type: 'Stair', entry: true, exit: true, connectors: ['st-street-u'], sources: ['nyopendata'] },
    ],
    fareLines: [],
  }
}

/** The fixture without the connectors named. */
export function without(interior: StationInterior, ...ids: string[]): StationInterior {
  return { ...interior, connectors: interior.connectors.filter((c) => !ids.includes(c.id)) }
}

/** The fixture with a slab's fields replaced. */
export function withSlab(interior: StationInterior, id: string, over: Partial<Slab>): StationInterior {
  return { ...interior, slabs: interior.slabs.map((s) => (s.id === id ? { ...s, ...over } : s)) }
}

/**
 * Adds the unpaid slab mezz-free (x 10..30, z 0..14 on the mezzanine level) between the two platforms, with a stair up
 * to it from each: quicker than the paid mezzanines' route once st-tu is gone.
 */
export function withFreeMezzanine(interior: StationInterior, paid: boolean | undefined = false): StationInterior {
  const slab: Slab = { id: 'mezz-free', level: 'mezz', name: 'Free mezzanine', outline: rect(10, 30, 0, 14), sources }
  return {
    ...interior,
    slabs: [...interior.slabs, paid === undefined ? slab : { ...slab, paid }].sort((a, b) => a.id.localeCompare(b.id)),
    connectors: [
      ...interior.connectors,
      connector('st-free-t', 'stair', [20, 2, 'platform-t', 'island-t'], [20, 3, 'mezz', 'mezz-free']),
      connector('st-free-u', 'stair', [20, 11, 'platform-u', 'island-u'], [20, 12, 'mezz', 'mezz-free']),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  }
}
