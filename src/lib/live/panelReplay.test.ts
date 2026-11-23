// What the station panel says on recorded polls (underground-dk6): for each arrival the feed reported (a train turning
// STOPPED_AT a stop it had a prediction for), re-renders the row `arrivalsAt` lists for it and its `minutesAway` the
// way the panel does, on every poll and on a 15 s tick (its TICK_MS) at five phases, and checks that a minute count rarely
// still shows once the train is in.
import { describe, expect, it } from 'vitest'
import type { FeedId } from '../../data/realtime'
import { arrivalsAt, minutesAway, stationOfStop, type ArrivalOptions } from './arrivals'
import { data, feedArrivals, liveNowAt, pollClocks, polls, quantile, type Arrival } from './pollReplay'

const TICK_S = 15
const PHASES = [0, 0.2, 0.4, 0.6, 0.8]
const clocks = pollClocks()
const end = polls[polls.length - 1]!.receivedAt

const routeById = new Map(Object.values(data.lookup.patterns).map((p) => [p.routeId, {}]))
const opts: ArrivalOptions = { lookup: data.lookup, routeById, stationName: (id) => id }

/** The panel's text for `e`'s trip at `e.stopId` at wall-clock `wall`: "Now", a minute count, or "gone" (no row). */
function shown(e: Arrival, wall: number): string {
  let k = -1
  while (k + 1 < polls.length && polls[k + 1]!.receivedAt <= wall) k++
  if (k < 0) return 'gone'
  const feed = e.key.slice(0, e.key.indexOf(':')) as FeedId
  const snapshot = polls[k]!.snapshot
  const trip = snapshot.feeds[feed].trips.find((t) => `${feed}:${t.tripId}` === e.key)
  if (!trip) return 'gone'
  // The panel's own rows for this one trip: arrivalsAt keeps, shifts and lists it.
  const alone = { ...snapshot, feeds: { ...snapshot.feeds, [feed]: { ...snapshot.feeds[feed], trips: [trip] } } }
  const nowS = liveNowAt(clocks[k]!.offset, wall)
  const station = { id: stationOfStop(e.stopId), stops: [e.stopId] }
  for (const group of arrivalsAt(alone, station, nowS, opts)) {
    const i = group.tripKeys.indexOf(e.key)
    if (i >= 0) return minutesAway(group.times[i]!, nowS)
  }
  return 'gone'
}

interface Outcome {
  /** Seconds a minute count showed after the train was in; 0 when none did. */
  lateS: number
  /** Seconds "Now" showed before the train was in, without a break. */
  earlyNowS: number
  /** The panel had a row for the train before it was in. */
  listed: boolean
}

function outcome(e: Arrival, phase: number): Outcome {
  const events = polls.map((p) => p.receivedAt)
  for (let t = polls[0]!.receivedAt + phase * TICK_S; t < end; t += TICK_S) events.push(t)
  const rows = events
    .filter((t) => t >= e.at - 400 && t <= e.at + 400)
    .sort((a, b) => a - b)
    .map((t) => ({ t, v: shown(e, t) }))
  let lateS = 0
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!
    const until = rows[i + 1]?.t ?? a.t + TICK_S
    if (a.v !== 'Now' && a.v !== 'gone') lateS += Math.max(0, until - Math.max(a.t, e.at))
  }
  // "Now" without a break up to the train's arrival, counted back from it.
  let earlyNowS = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i]!
    if (a.t > e.at) continue
    if (a.v !== 'Now') break
    earlyNowS = e.at - a.t
  }
  return { lateS, earlyNowS, listed: rows.some((r) => r.t <= e.at && r.v !== 'gone') }
}

describe('the station panel on recorded polls', () => {
  const outcomes = feedArrivals().flatMap((e) => PHASES.map((p) => outcome(e, p)))

  it('has enough renders to read a share from', () => {
    expect(outcomes.length).toBeGreaterThanOrEqual(150)
  })

  it('lists the train before it is in on nearly every render, so the checks below read real rows', () => {
    expect(outcomes.filter((o) => o.listed).length / outcomes.length).toBeGreaterThanOrEqual(0.95)
  })

  it('shows a minute count after the train is in on at most a fifth of renders (no shift: about 9 in 10)', () => {
    const late = outcomes.filter((o) => o.lateS > 0).length / outcomes.length
    expect(late).toBeLessThanOrEqual(0.2)
  })

  it('says "Now" at most about 70 s before the train for nine renders in ten (the deliberate early-side trade-off)', () => {
    expect(quantile(outcomes.map((o) => o.earlyNowS), 0.9)).toBeLessThanOrEqual(70)
  })
})
