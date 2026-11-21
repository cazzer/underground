import type { Route, Station, StationId, RouteId, Transfer } from '../../src/data/schema.ts'
import { compareIds, parseNum, type GtfsFeed } from './gtfs.ts'

const round5 = (degrees: number): number => Math.round(degrees * 1e5) / 1e5

/** Parent stations (location_type 1) with their platforms and the routes that call there. */
export function buildStations(feed: GtfsFeed): Station[] {
  const sortOrder = new Map(feed.routes.map((r) => [r.id, r.sortOrder]))
  const routeOfTrip = new Map(feed.trips.map((t) => [t.id, t.routeId]))
  const stationOfStop = new Map(feed.stops.map((s) => [s.id, s.locationType === 1 ? s.id : s.parent]))
  const routesAt = new Map<StationId, Set<RouteId>>()
  for (const { tripId, stopId } of feed.stopTimes) {
    const route = routeOfTrip.get(tripId)
    const station = stationOfStop.get(stopId)
    if (route === undefined) throw new Error(`stop_times references unknown trip ${tripId}`)
    if (station === undefined) throw new Error(`stop_times references unknown stop ${stopId}`)
    const set = routesAt.get(station)
    if (set) set.add(route)
    else routesAt.set(station, new Set([route]))
  }
  const orderOf = (route: RouteId): number => {
    const order = sortOrder.get(route)
    if (order === undefined) throw new Error(`Trip references unknown route ${route}`)
    return order
  }
  return feed.stops
    .filter((s) => s.locationType === 1)
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: round5(s.lat),
      lon: round5(s.lon),
      stops: feed.stops
        .filter((c) => c.parent === s.id)
        .map((c) => c.id)
        .sort(compareIds),
      routes: [...(routesAt.get(s.id) ?? [])].sort((a, b) => orderOf(a) - orderOf(b) || compareIds(a, b)),
    }))
    .sort((a, b) => compareIds(a.id, b.id))
}

function normalizeColor(value: string, fallback: string, what: string): string {
  const hex = (value.trim() || fallback).replace(/^#/, '').toUpperCase()
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error(`Bad ${what} ${JSON.stringify(value)}`)
  return hex
}

export function buildRoutes(feed: GtfsFeed): Route[] {
  return [...feed.routes]
    .sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.id, b.id))
    .map((r) => ({
      id: r.id,
      shortName: r.shortName,
      longName: r.longName,
      color: normalizeColor(r.color, 'FFFFFF', `route_color of ${r.id}`),
      textColor: normalizeColor(r.textColor, '000000', `route_text_color of ${r.id}`),
    }))
}

/** Station-to-station transfers. Self-transfers are dropped. */
export function buildTransfers(feed: GtfsFeed): Transfer[] {
  return feed.transfers
    .filter((t) => t.from !== t.to)
    .map((t) => ({
      from: t.from,
      to: t.to,
      minTransferSec: parseNum(t.minTransferTime, `min_transfer_time ${t.from}>${t.to}`),
    }))
    .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to))
}
