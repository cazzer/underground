/** Mini static world for tests: stations on a meridian (0.01 degrees of latitude is about 1112 m). */
import { E5, deltaEncode } from '../../data/codec'
import type {
  Direction,
  Shape,
  ShapesFile,
  Station,
  StationsFile,
  StopId,
  TripIndexFile,
  TripPattern,
} from '../../data/schema'
import { buildShapeGeometries } from './shapeGeometry'
import { buildTripLookup } from './tripLookup'

export const FEED_VERSION = 'test-feed'

interface Spot {
  id: string
  lat: number
  lon: number
}

// Main line, north to south by increasing latitude.
const MAIN: Spot[] = [
  { id: '101', lat: 40.7, lon: -74.0 },
  { id: '102', lat: 40.71, lon: -74.0 },
  { id: '103', lat: 40.72, lon: -74.0 },
  { id: '104', lat: 40.73, lon: -74.0 },
]
// Staten Island line, south-bound ids S03 -> S01.
const SI: Spot[] = [
  { id: 'S01', lat: 40.6, lon: -74.1 },
  { id: 'S02', lat: 40.61, lon: -74.1 },
  { id: 'S03', lat: 40.62, lon: -74.1 },
]

const station = (s: Spot): Station => ({
  id: s.id,
  name: s.id,
  lat: s.lat,
  lon: s.lon,
  stops: [`${s.id}N`, `${s.id}S`],
  routes: [],
})

const spotOf = new Map([...MAIN, ...SI].map((s) => [s.id, s]))

function shape(id: string, routeId: string, direction: Direction, primary: boolean, stops: StopId[]): Shape {
  const points = stops.map((stop) => spotOf.get(stop.slice(0, -1))!)
  return {
    id,
    routeId,
    direction,
    primary,
    lat: deltaEncode(points.map((p) => Math.round(p.lat * E5))),
    lon: deltaEncode(points.map((p) => Math.round(p.lon * E5))),
  }
}

const N_STOPS = ['101N', '102N', '103N']
const S_STOPS = ['103S', '102S', '101S']

const DEFS: { id: string; routeId: string; direction: Direction; primary: boolean; stops: StopId[] }[] = [
  { id: '1..N03R', routeId: '1', direction: 'N', primary: true, stops: N_STOPS },
  { id: '1..N05R', routeId: '1', direction: 'N', primary: false, stops: ['102N', '103N', '104N'] },
  { id: '1..S01R', routeId: '1', direction: 'S', primary: false, stops: ['102S', '101S'] },
  { id: '1..S03R', routeId: '1', direction: 'S', primary: true, stops: S_STOPS },
  { id: 'N..N70R', routeId: 'W', direction: 'N', primary: true, stops: N_STOPS },
  { id: 'N..S70R', routeId: 'W', direction: 'S', primary: true, stops: S_STOPS },
  { id: 'N..S72R', routeId: 'N', direction: 'S', primary: true, stops: ['103S', '102S'] },
  { id: 'SI..S03R', routeId: 'SI', direction: 'S', primary: true, stops: ['S03S', 'S02S', 'S01S'] },
]

export const stations: StationsFile = {
  feedVersion: FEED_VERSION,
  stations: [...MAIN, ...SI].map(station).sort((a, b) => a.id.localeCompare(b.id)),
}

export const shapes: ShapesFile = {
  feedVersion: FEED_VERSION,
  shapes: DEFS.map((d) => shape(d.id, d.routeId, d.direction, d.primary, d.stops)).sort((a, b) => a.id.localeCompare(b.id)),
}

const patterns: Record<string, TripPattern> = Object.fromEntries(
  DEFS.map((d) => [d.id, { routeId: d.routeId, direction: d.direction, stops: d.stops }]),
)

export const index: TripIndexFile = {
  feedVersion: FEED_VERSION,
  calendar: {
    Weekday: { days: [1, 2, 3, 4, 5], start: '20261101', end: '20270515' },
    Saturday: { days: [6], start: '20261101', end: '20270515' },
    Sunday: { days: [0], start: '20261101', end: '20270515' },
  },
  calendarExceptions: [
    { date: '20261126', serviceId: 'Sunday', exceptionType: 1 },
    { date: '20261126', serviceId: 'Weekday', exceptionType: 2 },
  ],
  patterns,
  origins: {
    Weekday: {
      '1..N03R': deltaEncode([129600, 130000, 145000]),
      '1..N05R': deltaEncode([130000]),
      // Primary sorts after the non-primary shape it collides with.
      '1..S01R': deltaEncode([131000]),
      '1..S03R': deltaEncode([131000]),
      'SI..S03R': deltaEncode([126600]),
      // N and W shapes share key 140000_N..S; W's is primary for W.
      'N..S70R': deltaEncode([123650, 140000]),
      'N..S72R': deltaEncode([140000]),
      'N..N70R': deltaEncode([128750]),
    },
    Saturday: { '1..N03R': [600] },
    Sunday: { '1..N03R': [700] },
  },
}

export const segments: Record<string, number> = { '101N>102N': 100, '102N>103N': 100 }

export const lookup = buildTripLookup(index, shapes)
export const geometries = buildShapeGeometries(shapes, index, stations, 0)
