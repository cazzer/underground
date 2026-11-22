// A catch-up glide over an eased run (runEase.ts): the plan's own speed changes under the glide, and a poll that
// lands mid-glide must continue it without a step back or a stall.
import { describe, expect, it } from 'vitest'
import { buildPolyline } from '../realtime/polyline'
import { hopDistance, type HopPlan } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import { RUN_RAMP_SHARE } from '../realtime/runEase'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { EMPTY_PROFILE } from '../trackProfile'
import { createSlotTable, reconcileSlots, stepSlot } from './slots'

const DT = 1 / 60
const geometry: ShapeGeometry = {
  shapeId: 'S',
  line: buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }]),
  stops: ['a', 'b'],
  stopDistances: [0, 1000],
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
  bandInputs: new Float32Array(0),
}
/** A 100 s eased run due at 1000 m at `arriveAt`. */
function trip(arriveAt: number): LiveTrip {
  const plan: HopPlan = {
    from: 0,
    to: 1,
    arriveAt,
    runS: 100,
    dwellS: 0,
    fixedFraction: null,
    minFraction: 0,
    departsInS: null,
    capped: false,
    rampShare: RUN_RAMP_SHARE,
  }
  return { key: 'a', shapeId: 'S', plan, geometry } as unknown as LiveTrip
}

interface Run {
  /** Displayed distance per frame, 1000 to 1025 s. */
  shown: number[]
  /** The frame the second poll landed on. */
  pollFrame: number
  /** The second poll kept the glide's end. */
  continued: boolean
  /** The new plan's target and where the old glide had got to, at the second poll. */
  target: number
  along: number
}

/**
 * A dot shown at 500 m when a poll at 1000 says the train is on `first` (it glides to catch up), polled again at
 * `repoll` with `second` (the same plan when omitted).
 */
function run(first: LiveTrip, repoll: number | null, second: LiveTrip = first): Run {
  const table = createSlotTable(1)
  reconcileSlots(table, [first], 0, { dataNow: 990, reducedMotion: false })
  table.displayed[0] = 500
  reconcileSlots(table, [first], 10, { dataNow: 1000, reducedMotion: false })
  const out: Run = { shown: [], pollFrame: -1, continued: false, target: NaN, along: NaN }
  for (let k = 0; k <= 25 / DT; k++) {
    const now = 1000 + k * DT
    if (repoll !== null && k === Math.round((repoll - 1000) / DT)) {
      const end = table.glideAt[0]! + table.glideT[0]!
      const u = (now - table.glideAt[0]!) / table.glideT[0]!
      out.along = hopDistance(first.plan, geometry, now) - table.glideE0[0]! * (1 - u * u * (3 - 2 * u))
      out.target = hopDistance(second.plan, geometry, now)
      reconcileSlots(table, [second], 10 + k * DT, { dataNow: now, reducedMotion: false })
      out.continued = table.glideAt[0]! + table.glideT[0]! === end
      out.pollFrame = k
    }
    out.shown.push(stepSlot(table, 0, hopDistance(table.trips[0]!.plan, geometry, now), now, 10 + k * DT, DT))
  }
  return out
}

/** The slowest the dot moves over any 0.25 s window in the second after the poll (m/s). */
function slowestAfterPoll(r: Run): number {
  const w = Math.round(0.25 / DT)
  let slowest = Infinity
  for (let k = r.pollFrame; k + w <= r.pollFrame + 1 / DT; k++) slowest = Math.min(slowest, (r.shown[k + w]! - r.shown[k]!) / 0.25)
  return slowest
}

/** Where the train due at `arriveAt` is at `now`, inverted by bisection: the arrival that puts it at `target` m. */
function arrivalFor(target: number, now: number): number {
  let lo = now
  let hi = now + 100
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (hopDistance(trip(mid).plan, geometry, now) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const neverBack = (shown: readonly number[]): void => {
  for (let k = 1; k < shown.length; k++) expect(shown[k]!, `frame ${k}`).toBeGreaterThanOrEqual(shown[k - 1]!)
}

describe('a glide over an eased run', () => {
  // Due at 1020: at 1000 the run is 80% through, braking from 875 m; the dot at 500 m glides 375 m.
  it('continues across a poll with the same plan exactly as if no poll had landed', () => {
    const alone = run(trip(1020), null)
    const polled = run(trip(1020), 1003)
    expect(polled.continued).toBe(true)
    for (let k = 0; k < alone.shown.length; k++) expect(polled.shown[k]!, `frame ${k}`).toBeCloseTo(alone.shown[k]!, 6)
  })

  it('never steps back, and ends within 5 m of the stop', () => {
    const { shown } = run(trip(1020), 1003)
    neverBack(shown)
    expect(1000 - shown[shown.length - 1]!).toBeLessThan(5)
  })

  it('continues onto a later arrival without stepping back or stalling', () => {
    const r = run(trip(1020), 1003, trip(1025))
    expect(r.continued).toBe(true)
    expect(r.target).toBeGreaterThan(r.along)
    neverBack(r.shown)
    expect(slowestAfterPoll(r)).toBeGreaterThan(20)
  })

  it('keeps tracking a moving target that lands between the dot and where the glide had got to', () => {
    // At 1003 the dot is at about 709.3 m and the old glide had got to 710.9 m: a poll puts the train at 710 m.
    const first = run(trip(1020), 1003)
    const at = (first.shown[first.pollFrame - 1]! + first.along) / 2
    const r = run(trip(1020), 1003, trip(arrivalFor(at, 1003)))
    expect(r.target).toBeGreaterThan(r.shown[r.pollFrame - 1]!)
    expect(r.target).toBeLessThan(r.along)
    expect(r.continued).toBe(true)
    neverBack(r.shown)
    // The train itself cruises at 12.5 m/s there; the dot must not drop to the per-frame ease's crawl over the gap.
    expect(slowestAfterPoll(r)).toBeGreaterThan(10)
  })
})
