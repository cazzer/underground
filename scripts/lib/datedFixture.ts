/** Feeds for datedTimetable.test.ts: fixtureFeed() with runs snapped to whole 30 s (the regular feed), and the same
 *  feed as a supplemented one. In the supplemented feed Weekday is split into two chunks; D1 (a Monday) drops chunk 2
 *  and adds the date-only X1 (one trip no regular service has); GAP (Tuesday) has no change; D2 adds X2; REMOVAL (a
 *  Tuesday outside that window) only drops chunk 2. HOLIDAY (Thanksgiving: Sunday service in both feeds) and 20261120
 *  (a Friday that adds Sunday service in both) change nothing. */
import { fixtureFeed } from './fixture.ts'
import { groupByTrip, type GtfsFeed, type StopTimeRow } from './gtfs.ts'

export const D1 = '20261123'
export const GAP = '20261124'
export const D2 = '20261125'
export const REMOVAL = '20261201'
export const HOLIDAY = '20261126'

export function regularFeed(): GtfsFeed {
  const feed = fixtureFeed()
  const rows: StopTimeRow[] = []
  for (const trip of groupByTrip(feed.stopTimes).values()) {
    let previousDeparture = 0
    trip.forEach((row, i) => {
      const dwell = row.departure - row.arrival
      const arrival = i === 0 ? row.arrival : previousDeparture + Math.round((row.arrival - trip[i - 1]!.departure) / 30) * 30
      rows.push({ ...row, arrival, departure: arrival + dwell })
      previousDeparture = arrival + dwell
    })
  }
  feed.stopTimes = rows
  return feed
}

function addWTrip(feed: GtfsFeed, service: string, id: string, departure: number): void {
  feed.trips.push({ id, routeId: 'W', serviceId: service, direction: 'S', shapeId: '' })
  feed.stopTimes.push(
    { tripId: id, stopId: 'B01S', arrival: departure, departure, sequence: 1 },
    { tripId: id, stopId: 'B03S', arrival: departure + 300, departure: departure + 300, sequence: 2 },
  )
}

export function supplementedFeed(): GtfsFeed {
  const feed = regularFeed()
  const weekday = feed.calendar.find((c) => c.serviceId === 'Weekday')!
  weekday.serviceId = 'Weekday_C1'
  feed.calendar.push({ ...weekday, serviceId: 'Weekday_C2' })
  // Chunk 2 holds the shuttle and the SIR trips; chunk 1 the rest.
  for (const trip of feed.trips) {
    if (trip.serviceId === 'Weekday') trip.serviceId = trip.routeId === 'GS' || trip.routeId === 'SI' ? 'Weekday_C2' : 'Weekday_C1'
  }
  // The regular feed's exceptions on Weekday apply to both chunks.
  feed.calendarDates = feed.calendarDates.flatMap((d) =>
    d.serviceId === 'Weekday' ? [{ ...d, serviceId: 'Weekday_C1' }, { ...d, serviceId: 'Weekday_C2' }] : [d],
  )
  feed.calendarDates.push(
    { serviceId: 'Weekday_C2', date: D1, exceptionType: 2 },
    { serviceId: 'X1', date: D1, exceptionType: 1 },
    { serviceId: 'X2', date: D2, exceptionType: 1 },
    { serviceId: 'Weekday_C2', date: REMOVAL, exceptionType: 2 },
  )
  addWTrip(feed, 'X1', 'X1_000700_', 600)
  addWTrip(feed, 'X2', 'X2_000800_', 900)
  return feed
}
