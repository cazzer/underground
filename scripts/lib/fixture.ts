/** A mini GtfsFeed for builder tests. Rows are deliberately out of order. */
import type { Direction } from '../../src/data/schema.ts'
import type { GtfsFeed, ShapePointRow, StopRow } from './gtfs.ts'

interface TripSpec {
  route: string
  service: string
  /** Raw shape_id as GTFS writes it, e.g. "GS.N01R". */
  shape: string
  direction: Direction
  origin: number
  stops: string[]
  /** Seconds between departing one stop and arriving at the next. */
  run: number
  dwell?: number
}

const station = (id: string, name: string, lat: number, lon: number, children: string[]): StopRow[] => [
  { id, name, lat, lon, locationType: 1, parent: '' },
  ...children.map((c) => ({ id: id + c, name, lat, lon, locationType: 0, parent: id })),
]

function addTrip(feed: GtfsFeed, spec: TripSpec): void {
  const id = `${spec.service}_${String(spec.origin).padStart(6, '0')}_${spec.shape}`
  feed.trips.push({ id, routeId: spec.route, serviceId: spec.service, direction: spec.direction, shapeId: spec.shape })
  let t = Math.round(spec.origin * 0.6) // origin is hundredths of a minute
  spec.stops.forEach((stopId, i) => {
    feed.stopTimes.push({ tripId: id, stopId, arrival: t, departure: t + (spec.dwell ?? 0), sequence: i + 1 })
    t += (spec.dwell ?? 0) + spec.run
  })
}

function addShape(feed: GtfsFeed, shapeId: string, points: [number, number][]): void {
  const rows: ShapePointRow[] = points.map(([lat, lon], sequence) => ({ shapeId, sequence, lat, lon }))
  feed.shapePoints.push(...rows)
}

export function fixtureFeed(): GtfsFeed {
  const feed: GtfsFeed = {
    feedVersion: 'fixture-1',
    stops: [
      ...station('A02', 'Beta St', 40.7010049, -74.0, ['S', 'N']),
      ...station('A01', 'Alpha St', 40.7000123, -74.0, ['S', 'N']),
      ...station('A03', 'Gamma St', 40.7020001, -74.0, ['N', 'S']),
      ...station('B01', 'Bee 1', 40.71, -74.01, ['S', 'N']),
      ...station('B02', 'Bee 2', 40.711, -74.01, ['S', 'N']),
      ...station('B03', 'Bee 3', 40.712, -74.01, ['S', 'N']),
      ...station('G01', 'Shuttle End', 40.703, -73.99, ['N', 'S']),
      ...station('Z99', 'Unserved', 40.8, -73.9, ['N', 'S']),
    ],
    routes: [
      { id: '1', shortName: '1', longName: 'Broadway', color: 'EE352E', textColor: 'FFFFFF', sortOrder: 5 },
      { id: 'W', shortName: 'W', longName: 'Broadway Local', color: 'fccc0a', textColor: '000000', sortOrder: 3 },
      { id: 'SI', shortName: 'SIR', longName: 'Staten Island Railway', color: '', textColor: '', sortOrder: 1 },
      { id: 'GS', shortName: 'S', longName: '42 St Shuttle', color: '6D6E71', textColor: 'FFFFFF', sortOrder: 2 },
    ],
    trips: [],
    stopTimes: [],
    shapePoints: [],
    transfers: [
      { from: 'B01', to: 'A01', minTransferTime: '60' },
      { from: 'A01', to: 'A01', minTransferTime: '180' },
      { from: 'A02', to: 'A01', minTransferTime: '180' },
      { from: 'A01', to: 'A02', minTransferTime: '120' },
    ],
    calendar: [
      { serviceId: 'Sunday', days: [0], start: '20261101', end: '20270515' },
      { serviceId: 'Weekday', days: [5, 1, 2, 3, 4], start: '20261101', end: '20270515' },
      { serviceId: 'Saturday', days: [6], start: '20261101', end: '20270515' },
    ],
    calendarDates: [
      { serviceId: 'Sunday', date: '20261126', exceptionType: 1 },
      { serviceId: 'Weekday', date: '20261126', exceptionType: 2 },
      { serviceId: 'Sunday', date: '20261120', exceptionType: 1 },
    ],
  }
  const aStops = ['A01S', 'A02S', 'A03S']
  const wStops = ['B01S', 'B02S', 'B03S']
  // 1..S03R and 1..S04R tie at two trips each; N..S72R beats N..S73R two to one.
  addTrip(feed, { route: '1', service: 'Weekday', shape: '1..S03R', direction: 'S', origin: 600, stops: aStops, run: 60 })
  addTrip(feed, { route: '1', service: 'Weekday', shape: '1..S03R', direction: 'S', origin: 2600, stops: aStops, run: 100 })
  addTrip(feed, { route: '1', service: 'Weekday', shape: '1..S04R', direction: 'S', origin: 1000, stops: ['A01S', 'A03S'], run: 200, dwell: 30 })
  addTrip(feed, { route: '1', service: 'Sunday', shape: '1..S04R', direction: 'S', origin: 1000, stops: ['A01S', 'A03S'], run: 200 })
  addTrip(feed, { route: 'W', service: 'Saturday', shape: 'N..S72R', direction: 'S', origin: 1200, stops: wStops, run: 120 })
  addTrip(feed, { route: 'W', service: 'Saturday', shape: 'N..S72R', direction: 'S', origin: 150000, stops: wStops, run: 300 }) // 25:00
  addTrip(feed, { route: 'W', service: 'Saturday', shape: 'N..S73R', direction: 'S', origin: 3000, stops: ['B01S', 'B03S'], run: 400 })
  addTrip(feed, { route: 'GS', service: 'Weekday', shape: 'GS.N01R', direction: 'N', origin: 100, stops: ['G01N', 'A02N'], run: 90 })
  // Zero run time: dropped from segments, and SI is the only route calling at these stops.
  addTrip(feed, { route: 'SI', service: 'Weekday', shape: 'SI..S03R', direction: 'S', origin: 500, stops: ['A01S', 'A02S'], run: 0 })
  feed.trips.push({ id: 'P_009000_', routeId: '1', serviceId: 'Weekday', direction: 'S', shapeId: '' })

  const north = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [40.7 + 0.001 * i, -74.0])
  addShape(feed, '1..S03R', north(12)) // collinear: simplifies to its ends
  addShape(feed, '1..S04R', [...north(3), [40.702, -73.998], [40.702, -73.996]]) // L shape
  addShape(feed, 'N..S72R', north(4))
  addShape(feed, 'N..S73R', north(3))
  addShape(feed, 'GS.N01R', north(2))
  addShape(feed, 'SI..S03R', north(2))
  addShape(feed, 'X..N99R', north(2)) // no trip uses it
  feed.shapePoints.reverse()
  feed.stopTimes.reverse()
  feed.trips.reverse()
  return feed
}
