/**
 * The router's timetable with the next 30 minutes taken from realtime. For each healthy feed, scheduled trips in
 * the window are replaced by their realtime twins, cancelled when the feed has none, and the feed's other trips
 * are added with predicted times (scheduled run times after the last prediction when the feed's horizon cut it
 * off). A trip that fits no scheduled stop sequence gets a pattern of its own. A stale or failing feed keeps its
 * schedule. Pure; feed data never throws (the caller falls back to the schedule on a programmer error).
 *
 * Queries should be at the live clock or later: stops a realtime trip has passed are pinned to one second before
 * `nowS`, so they cannot be boarded, and an earlier query would see them as late. Trips are matched by route and
 * first departure, not by feed, so a trip of a stale feed's route that arrives in a healthy feed (`offFeed`) still
 * replaces its twin: intentional, its prediction is the better data.
 */
import { parseTripId, type ParsedTripId } from '../../data/codec'
import { ARRIVAL_HORIZON_S, FEED_IDS, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import type { Direction, RouteId } from '../../data/schema'
import { SNAPSHOT_MAX_AGE_S } from '../live/clock'
import { ROUTE_FEED } from '../live/feedHealth'
import { ghostReason } from '../realtime/filters'
import { joinTrip, matchScheduled, type ScheduledMatch } from '../realtime/joinTrip'
import { serviceDayStart } from '../realtime/serviceDate'
import type { TripLookup } from '../realtime/tripLookup'
import { buildTimetable } from './patterns'
import { assignTwins, type TwinQuery } from './overlayMatch'
import { ONE_OFF_PREFIX, groupPatterns, oneOffGroup, oneOffKey, rebuildPatterns, type Group, type Row } from './overlayGroups'
import { findRun, nearestRow, predictedRun, rowOnPattern, type PredictedRun } from './overlayRows'
import type { Timetable } from './types'

/** Scheduled trips this far past now are replaced by the feed's. The Worker drops trip_replacement_period, so
 *  this is assumed to be the MTA's window. */
export const REPLACEMENT_WINDOW_S = 1800

export interface OverlayInput {
  snapshot: RealtimeSnapshot
  /** The live clock, epoch seconds. */
  nowS: number
  /** The date (YYYYMMDD) whose `serviceDayStart` is the timetable's time base. */
  day: string
  lookup: TripLookup
}

export interface OverlayCounts {
  /** Feeds whose trips were overlaid, and feeds that kept the schedule (stale, failing, or the snapshot too old). */
  liveFeeds: FeedId[]
  scheduleFeeds: FeedId[]
  /** Realtime trips placed on their twin's stop sequence, on another scheduled one, or on a pattern of their own. */
  onTwin: number
  onHost: number
  oneOff: number
  /** Scheduled trips replaced by a realtime twin, and dropped for having none. */
  replaced: number
  cancelled: number
  /** Trips continued past their last prediction by the schedule; trips with a prediction raised to keep order. */
  extended: number
  clamped: number
  skipped: { ghost: number; noKnownStop: number; tooShort: number }
  /** Trips whose route belongs to another feed than the one they came in on. */
  offFeed: number
}

export interface OverlayResult {
  timetable: Timetable
  counts: OverlayCounts
}

interface Pending {
  feed: FeedId
  trip: RealtimeTrip
  run: PredictedRun
  p: ParsedTripId | null
  /** The first scheduled key the trip id hits (`matchScheduled`), computed once. */
  match: ScheduledMatch | null
}

const emptyCounts = (): OverlayCounts => ({
  liveFeeds: [],
  scheduleFeeds: [],
  onTwin: 0,
  onHost: 0,
  oneOff: 0,
  replaced: 0,
  cancelled: 0,
  extended: 0,
  clamped: 0,
  skipped: { ghost: 0, noKnownStop: 0, tooShort: 0 },
  offFeed: 0,
})

const sameStops = (a: readonly string[], b: readonly string[] | undefined): boolean =>
  b !== undefined && a.length === b.length && a.every((s, i) => s === b[i])

/** Host order: the join's own stop sequence, then more stops, then key. */
function beats(a: Group, aExact: number, b: Group, bExact: number): boolean {
  if (aExact !== bExact) return aExact < bExact
  if (a.stops.length !== b.stops.length) return a.stops.length > b.stops.length
  return a.key < b.key
}

const directionOfStop = (id: string): Direction => (id.endsWith('S') ? 'S' : 'N')

interface HostChoice {
  group: Group
  /** Where the run starts in the group's stops. */
  at: number
  /** A scheduled row of the group to take run times from; never boarded, so it may be removed. */
  ref: Row
}

/**
 * The stop sequences a trip can sit on, best first: its twin's when it holds the run (the ref is the twin), then
 * the other scheduled sequences of its direction that hold it and have a scheduled trip on the trip's route or
 * its join's. Reroutes never host, and nor does what this overlay added (`group.routes` is only the schedule's).
 */
function hostsFor(
  groups: ReadonlyMap<string, Group>,
  stopIds: readonly string[],
  run: PredictedRun,
  twin: Row | null,
  tripRoute: RouteId,
  joinPattern: { routeId: RouteId; stops: readonly string[] } | undefined,
  refFor: (group: Group, at: number) => Row | null,
): HostChoice[] {
  const out: HostChoice[] = []
  const twinAt = twin ? findRun(twin.group.stops, run.stops) : -1
  if (twin && twinAt >= 0) out.push({ group: twin.group, at: twinAt, ref: twin })
  const routes = new Set([tripRoute, ...(joinPattern ? [joinPattern.routeId] : [])])
  const direction = directionOfStop(stopIds[run.stops[0]!]!)
  const found: { group: Group; at: number; exact: number }[] = []
  for (const group of groups.values()) {
    if (group.key.startsWith(ONE_OFF_PREFIX) || group.direction !== direction || group === twin?.group) continue
    if (![...routes].some((r) => group.routes.has(r))) continue
    const at = findRun(group.stops, run.stops)
    if (at >= 0) found.push({ group, at, exact: sameStops(group.stopIds, joinPattern?.stops) ? 0 : 1 })
  }
  found.sort((a, b) => (beats(a.group, a.exact, b.group, b.exact) ? -1 : beats(b.group, b.exact, a.group, a.exact) ? 1 : 0))
  for (const { group, at } of found) {
    const ref = refFor(group, at)
    if (ref) out.push({ group, at, ref })
  }
  return out
}

export function overlayRealtime(scheduled: Timetable, input: OverlayInput): OverlayResult {
  const { snapshot, nowS, day, lookup } = input
  const counts = emptyCounts()
  if (nowS - snapshot.generatedAt > SNAPSHOT_MAX_AGE_S) {
    counts.scheduleFeeds = [...FEED_IDS]
    return { timetable: scheduled, counts }
  }
  const index = scheduled.stops
  const dayStart = serviceDayStart(day)
  const nowDay = Math.floor(nowS - dayStart)
  const bounds = { nowDay, horizonDay: snapshot.generatedAt - dayStart + ARRIVAL_HORIZON_S }
  const windowEnd = nowDay + REPLACEMENT_WINDOW_S
  const groups = groupPatterns(scheduled)

  const healthy = new Set<FeedId>()
  const pending: Pending[] = []
  for (const feed of FEED_IDS) {
    const f = snapshot.feeds[feed]
    if (f.stale || f.error !== null) {
      counts.scheduleFeeds.push(feed)
      continue
    }
    healthy.add(feed)
    counts.liveFeeds.push(feed)
    for (const trip of f.trips) {
      // Unassigned trips are real departures, so only the other ghost tests apply.
      if (ghostReason({ ...trip, assigned: true }, nowS) !== null) {
        counts.skipped.ghost += 1
        continue
      }
      const run = predictedRun(trip.arrivals, index, dayStart)
      if (run.stops.length === 0) {
        counts.skipped.noKnownStop += 1
        continue
      }
      const p = parseTripId(trip.tripId)
      pending.push({ feed, trip, run, p, match: p && matchScheduled(trip, p, lookup, nowS) })
    }
  }

  const queries = pending.map(({ trip, run, p, match: m }): TwinQuery | null => {
    if (!p || !m) return null
    const routes = new Set<RouteId>()
    for (const s of m.shapes) {
      const routeId = lookup.patterns[s]?.routeId
      if (routeId !== undefined) routes.add(routeId)
    }
    if (routes.size === 0) routes.add(trip.route)
    const originS = serviceDayStart(m.day) - dayStart + Math.round(m.origin * 0.6)
    return { routes, direction: p.direction, originS, run: run.stops }
  })
  const twins = assignTwins(groups.values(), queries)
  for (const twin of twins) {
    if (!twin) continue
    twin.removed = true
    twin.group.changed = true
    counts.replaced += 1
  }

  for (const group of groups.values()) {
    const n = group.stops.length
    for (const row of group.rows) {
      const feed = ROUTE_FEED[row.routeId]
      if (row.removed || feed === undefined || !healthy.has(feed)) continue
      if (row.dep[0]! > windowEnd || row.arr[n - 1]! < nowDay) continue
      row.removed = true
      group.changed = true
      counts.cancelled += 1
    }
  }

  pending.forEach(({ feed, trip, run }, i) => {
    if (ROUTE_FEED[trip.route] !== feed) counts.offFeed += 1
    if (run.clamped) counts.clamped += 1
    const id = `${feed}:${trip.tripId}`
    const twin = twins[i] ?? null
    const join = joinTrip(trip, lookup, nowS)
    const joinPattern = join.matched ? lookup.patterns[join.shapeId] : undefined
    const routeId = twin?.routeId ?? joinPattern?.routeId ?? trip.route
    const times = run.times

    const hosts = hostsFor(groups, index.stopIds, run, twin, trip.route, joinPattern, (g, at) => nearestRow(g.rows, at, times[0]!))
    for (const { group, at, ref } of hosts) {
      const placed = rowOnPattern(group.stops.length, at, run, ref, bounds)
      if (!placed) continue
      group.added.push({ id, routeId, arr: placed.arr, dep: placed.dep, live: true })
      group.changed = true
      if (ref === twin) counts.onTwin += 1
      else counts.onHost += 1
      if (placed.extended) counts.extended += 1
      return
    }

    if (run.stops.length < 2) {
      counts.skipped.tooShort += 1
      return
    }
    const stopIds = Array.from(run.stops, (s) => index.stopIds[s]!)
    const key = oneOffKey(stopIds)
    let group = groups.get(key)
    if (!group) {
      group = oneOffGroup(index, stopIds)
      groups.set(key, group)
    }
    group.added.push({ id, routeId, arr: times, dep: times, live: true })
    group.changed = true
    counts.oneOff += 1
  })

  if (![...groups.values()].some((g) => g.changed)) return { timetable: scheduled, counts }
  return { timetable: buildTimetable(index, rebuildPatterns(index, groups)), counts }
}
