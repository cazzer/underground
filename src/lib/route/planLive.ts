/**
 * Journeys on the timetable with the realtime overlay laid over it. Pure apart from `console.error`. The overlay
 * (about 100 ms on a poll's worth of trips) is built once per (timetable, snapshot) and reused by every query on
 * it, so the 30 s refresh and a changed pair never redo it; its `nowS` is that of the first query, which only
 * decides which stops count as passed, and a query is always at or after it.
 */
import type { RealtimeSnapshot } from '../../data/realtime'
import type { StationId } from '../../data/schema'
import { SNAPSHOT_MAX_AGE_S } from '../live/clock'
import type { TripLookup } from '../realtime/tripLookup'
import { overlayRealtime, type OverlayCounts, type OverlayResult } from './overlay'
import { planOn, type RouterTimetable, type TripJourney } from './plan'
import type { RouteOptions } from './types'

export interface LiveInput {
  snapshot: RealtimeSnapshot
  lookup: TripLookup
}

export interface LivePlan {
  journeys: TripJourney[]
  /** What the overlay did; null when it did not run (no snapshot) or threw (the schedule was used). */
  overlay: OverlayCounts | null
}

interface Memo {
  rt: RouterTimetable
  snapshot: RealtimeSnapshot
  /** null: the overlay threw for this pair, and was logged. */
  result: OverlayResult | null
}
let memo: Memo | undefined

/** User Timing measure `name` from `start` (a `performance.now()` value) to now. */
const measureSince = (name: string, start: number): void => void performance.measure(name, { start, end: performance.now() })

function overlayOf(rt: RouterTimetable, live: LiveInput, atS: number): OverlayResult | null {
  const stale = atS - live.snapshot.generatedAt > SNAPSHOT_MAX_AGE_S
  // A snapshot gone too old for the overlay is a cheap all-schedule answer; it must not stand in for a fresh one.
  if (!stale && memo?.rt === rt && memo.snapshot === live.snapshot) return memo.result
  const start = performance.now()
  let result: OverlayResult | null
  try {
    result = overlayRealtime(rt.timetable, { snapshot: live.snapshot, nowS: atS, day: rt.window.date, lookup: live.lookup })
  } catch (e) {
    console.error('Trip overlay failed; planning on the schedule', e)
    result = null
  }
  measureSince('trip:overlay', start)
  if (!stale) memo = { rt, snapshot: live.snapshot, result }
  return result
}

/**
 * Journeys from any of `from` to any of `to` leaving no earlier than `atS` (epoch seconds, the live clock when
 * `live` is given). A throwing overlay is logged once per snapshot and the schedule answers.
 */
export function planOnLive(
  rt: RouterTimetable,
  from: readonly StationId[],
  to: readonly StationId[],
  atS: number,
  live: LiveInput | null,
  opts?: RouteOptions,
): LivePlan {
  const overlaid = live ? overlayOf(rt, live, atS) : null
  const start = performance.now()
  const journeys = planOn(overlaid ? { timetable: overlaid.timetable, window: rt.window } : rt, from, to, atS, opts)
  measureSince('trip:route', start)
  return { journeys, overlay: overlaid?.counts ?? null }
}
