/**
 * The route frame on the committed public/data: the L08 to 127 journeys (a change at Union Sq or not, whatever the
 * feed holds) land with every point of the route, stations included, inside the padded free rect at a phone's open
 * and collapsed panel and on a desktop, never closer than the tilt's top-down distance.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile, ShapesFile, StationsFile, TransfersFile, TripIndexFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import type { TimetableFile } from '../data/timetableSchema'
import { PHONE_COLLAPSED } from './collapseFixture'
import { EXIT_DISTANCE } from './focusMachine'
import { interiorFreeRect, type ScreenRect } from './interiorCamera'
import { buildNetwork } from './network'
import { route } from './route/raptor'
import { buildRouterTimetable } from './route/timetable'
import type { TripJourney } from './route/plan'
import { frameTopDown, legStationPoints, ROUTE_MIN_DISTANCE, ROUTE_PAD_PX, routeFramePoints } from './routeFrame'
import { TRACK_OFFSET_M } from './trackOffset'
import { journeySpans, stopStations } from './tripSpans'

const FOV = 35
const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const stationsFile = read<StationsFile>('stations.json')
const network = buildNetwork(
  stationsFile,
  read<RoutesFile>('routes.json'),
  read<ShapesFile>('shapes.json'),
  TRACK_OFFSET_M,
  read<PackedDepthsFile>('station-depths.json'),
  2,
)
const stops = stopStations(network.stations)
const hint = read<TripIndexFile>('trip-index.json').patterns

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
const timetable = buildRouterTimetable(
  [{ label: 'Weekday', shiftS: 0, file: read<TimetableFile>('timetable/Weekday.json') }],
  stationsFile,
  read<TransfersFile>('route/transfers.json').transfers,
)
warn.mockRestore()

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const views: [string, typeof PHONE, ScreenRect][] = [
  ['phone, panel open', PHONE, interiorFreeRect(PHONE, { top: 60, bottom: 24 }, { left: 0, top: 410, right: 390, bottom: 844 })],
  ['phone, panel collapsed', PHONE_COLLAPSED.viewport, PHONE_COLLAPSED.free],
  ['desktop, side panel', DESKTOP, interiorFreeRect(DESKTOP, { top: 60, bottom: 24 }, { left: 1040, top: 60, right: 1440, bottom: 876 })],
]

describe('the L08 to 127 route frame', { timeout: 60_000 }, () => {
  const journeys = route(timetable, ['L08'], ['127'], 28800)
  it('has journeys', () => {
    expect(journeys.length).toBeGreaterThan(0)
  })

  it.each(views)('frames every point of every journey inside the padded free rect, %s', (_, viewport, free) => {
    for (const j of journeys) {
      // The router's legs carry no clock times; the frame reads stops only.
      const legs = j.legs.map((l) => (l.kind === 'ride' ? { ...l, departAt: 0, arriveAt: 0, terminalStop: l.alightStop } : { ...l, startAt: 0, endAt: 0 })) as TripJourney['legs']
      const spans = journeySpans(legs, { shapes: network.shapes, stopStations: stops, patterns: hint })
      const points = routeFramePoints(spans, network.shapeById, legStationPoints(legs, stops))
      expect(points.length).toBeGreaterThan(2)
      const f = frameTopDown(points, viewport, free, FOV, ROUTE_MIN_DISTANCE, 200_000)
      expect(f.distance).toBeGreaterThan(EXIT_DISTANCE)
      const mpp = (2 * f.distance * Math.tan((FOV * Math.PI) / 360)) / viewport.height
      for (const p of points) {
        const x = viewport.width / 2 + (p.x - f.target.x) / mpp
        const y = viewport.height / 2 + (p.z - f.target.z) / mpp
        expect(x).toBeGreaterThanOrEqual(free.left + ROUTE_PAD_PX - 1e-6)
        expect(x).toBeLessThanOrEqual(free.right - ROUTE_PAD_PX + 1e-6)
        expect(y).toBeGreaterThanOrEqual(free.top + ROUTE_PAD_PX - 1e-6)
        expect(y).toBeLessThanOrEqual(free.bottom - ROUTE_PAD_PX + 1e-6)
      }
    }
  })
})
