import { canonicalShapeId, deltaEncode, parseTripId } from '../../src/data/codec.ts'
import type {
  CalendarException,
  ServiceCalendar,
  ServiceId,
  ShapeId,
  TripIndexFile,
  TripPattern,
} from '../../src/data/schema.ts'
import { compareIds, groupByTrip, type GtfsFeed } from './gtfs.ts'

type Body = Omit<TripIndexFile, 'feedVersion'>

function sortedRecord<T>(map: ReadonlyMap<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of [...map.keys()].sort(compareIds)) out[key] = map.get(key)!
  return out
}

/** One stop pattern per shape plus every trip's origin time, per service. Trips with no
 *  shape are skipped and counted. Throws if a shape maps to more than one stop sequence. */
export function buildTripIndex(feed: GtfsFeed): { file: Body; skippedNoShape: number } {
  const stopsByTrip = groupByTrip(feed.stopTimes)
  const patterns = new Map<ShapeId, TripPattern>()
  const origins = new Map<ServiceId, Map<ShapeId, number[]>>()
  let skippedNoShape = 0

  for (const trip of feed.trips) {
    if (trip.shapeId === '') {
      skippedNoShape++
      continue
    }
    const shape = canonicalShapeId(trip.shapeId)
    const parsed = parseTripId(trip.id)
    if (!parsed) throw new Error(`Cannot parse trip id ${trip.id}`)
    const rows = stopsByTrip.get(trip.id)
    if (!rows) throw new Error(`Trip ${trip.id} has no stop_times`)
    const stops = rows.map((r) => r.stopId)

    const known = patterns.get(shape)
    if (!known) {
      patterns.set(shape, { routeId: trip.routeId, direction: trip.direction, stops })
    } else if (
      known.routeId !== trip.routeId ||
      known.direction !== trip.direction ||
      known.stops.join() !== stops.join()
    ) {
      throw new Error(`Shape ${shape} maps to more than one pattern (trip ${trip.id})`)
    }

    const byShape = origins.get(trip.serviceId) ?? new Map<ShapeId, number[]>()
    origins.set(trip.serviceId, byShape)
    const list = byShape.get(shape)
    if (list) list.push(parsed.origin)
    else byShape.set(shape, [parsed.origin])
  }

  const encoded = new Map<ServiceId, Record<ShapeId, number[]>>()
  for (const [service, byShape] of origins) {
    const perShape = new Map<ShapeId, number[]>()
    for (const [shape, list] of byShape) perShape.set(shape, deltaEncode([...new Set(list)].sort((a, b) => a - b)))
    encoded.set(service, sortedRecord(perShape))
  }

  const calendar = new Map<ServiceId, ServiceCalendar>(
    feed.calendar.map((c) => [c.serviceId, { days: [...c.days].sort((a, b) => a - b), start: c.start, end: c.end }]),
  )
  const calendarExceptions: CalendarException[] = feed.calendarDates
    .map((d) => ({ date: d.date, serviceId: d.serviceId, exceptionType: d.exceptionType }))
    .sort((a, b) => compareIds(a.date, b.date) || compareIds(a.serviceId, b.serviceId))

  return {
    file: {
      calendar: sortedRecord(calendar),
      calendarExceptions,
      patterns: sortedRecord(patterns),
      origins: sortedRecord(encoded),
    },
    skippedNoShape,
  }
}
