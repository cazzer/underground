import { describe, expect, it } from 'vitest'
import { FEED_IDS, type Arrival, type VehicleStatus } from '../../data/realtime'
import { EMPTY_PROFILE } from '../trackProfile'
import { ARRIVAL_SHIFT_MAX_SHARE, ARRIVAL_SHIFT_S, hopArrivalShift, shownArrival } from './arrivalShift'
import { buildPolyline } from './polyline'
import { dwellFor, hopFraction, planHop, type HopPlan } from './position'
import { MAX_CRUISE_MPS } from './runEase'
import type { ShapeGeometry } from './shapeGeometry'
import type { StopVisit } from './stopVisit'

const NOW = 1_795_228_554

const geometry = (distances: number[]): ShapeGeometry => ({
  shapeId: '1..N03R',
  line: buildPolyline(distances.map((d) => ({ x: 0, z: -d }))),
  stops: ['101N', '102N', '103N'].slice(0, distances.length),
  stopDistances: distances,
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
  bandInputs: new Float32Array(0),
})
// 1000 m hops of 100 s: a 30 s dwell, then 70 s of running (14.3 m/s).
const slow = geometry([0, 1000, 2000])
const SEGMENTS = { '101N>102N': 100, '102N>103N': 100 }

interface Over {
  status?: VehicleStatus | null
  stopId?: string | null
  arrivals?: Arrival[]
  visit?: StopVisit | null
  geometry?: ShapeGeometry
  segments?: Record<string, number>
}
const plan = (over: Over, arrivalShiftS?: number): HopPlan => {
  const p = planHop({
    geometry: over.geometry ?? slow,
    status: over.status === undefined ? 'IN_TRANSIT_TO' : over.status,
    stopId: over.stopId === undefined ? '102N' : over.stopId,
    arrivals: over.arrivals ?? [['102N', NOW + 100]],
    segments: over.segments ?? SEGMENTS,
    now: NOW,
    visit: over.visit,
    arrivalShiftS,
  })
  if ('ok' in p) throw new Error(`no plan: ${p.reason}`)
  return p
}
/** When the train leaves its origin: unaffected by the shift. */
const leaveAt = (p: HopPlan): number => p.arriveAt! - (p.runS - p.dwellS)

const visit = (over: Partial<StopVisit>): StopVisit => ({ stopId: '101N', arrivedAt: NOW - 20, leftAfter: null, here: false, ...over })

describe('ARRIVAL_SHIFT_S', () => {
  it('has a finite shift of 0 to 30 s for every feed', () => {
    for (const feed of FEED_IDS) {
      expect(Number.isFinite(ARRIVAL_SHIFT_S[feed]), feed).toBe(true)
      expect(ARRIVAL_SHIFT_S[feed], feed).toBeGreaterThanOrEqual(0)
      expect(ARRIVAL_SHIFT_S[feed], feed).toBeLessThanOrEqual(30)
    }
  })
  it('shows a predicted arrival sooner by its feed\'s shift', () => {
    expect(shownArrival('l', NOW)).toBe(NOW - ARRIVAL_SHIFT_S.l)
    expect(shownArrival('nqrw', NOW + 90)).toBe(NOW + 90 - ARRIVAL_SHIFT_S.nqrw)
  })
})

describe('hopArrivalShift', () => {
  it('takes the whole shift from a hop with room', () => {
    expect(hopArrivalShift(20, 70, 1000)).toBe(20)
  })
  it('takes at most its share of the running time', () => {
    expect(hopArrivalShift(30, 20, 100)).toBe(ARRIVAL_SHIFT_MAX_SHARE * 20)
  })
  it('leaves the hop no faster than 25 m/s on average', () => {
    // 1500 m in 70 s needs 60 s at 25 m/s, so only 10 s can go.
    expect(hopArrivalShift(30, 70, 1500)).toBe(70 - 1500 / MAX_CRUISE_MPS)
  })
  it('is never negative, even on a hop already faster than that', () => {
    expect(hopArrivalShift(30, 40, 1500)).toBe(0)
    expect(hopArrivalShift(0, 70, 1000)).toBe(0)
  })
})

describe('planHop with an arrival shift', () => {
  it('pulls an uncapped arrival in and gives the dwell the same seconds, so the train leaves when it did', () => {
    const base = plan({})
    const shifted = plan({}, 20)
    expect(shifted.arriveAt).toBe(base.arriveAt! - 20)
    expect(shifted.dwellS).toBe(base.dwellS + 20)
    expect(leaveAt(shifted)).toBeCloseTo(leaveAt(base), 9)
    expect(shifted.capped).toBe(false)
  })

  it('does the same to the capped arrival, which still reads as capped', () => {
    // Predicted 100 s out, but the schedule from the visit says about 86 s.
    const over = { stopId: '103N', arrivals: [['103N', NOW + 100]] as Arrival[], visit: visit({ stopId: '102N' }) }
    const base = plan(over)
    const shifted = plan(over, 20)
    expect(base.capped).toBe(true)
    expect(shifted.capped).toBe(true)
    expect(shifted.arriveAt).toBe(base.arriveAt! - 20)
    expect(leaveAt(shifted)).toBeCloseTo(leaveAt(base), 9)
  })

  it('shifts nothing while the poll still has the train at the platform it leaves', () => {
    const here = visit({ here: true, leftAfter: NOW })
    const base = plan({ visit: here })
    const shifted = plan({ visit: here }, 20)
    expect(shifted.arriveAt).toBe(base.arriveAt)
    expect(shifted.dwellS).toBe(dwellFor(100))
    // A visit to another stop is no hold.
    expect(plan({ visit: visit({ stopId: '103N', here: true }) }, 20).arriveAt).toBe(NOW + 80)
  })

  it('takes less from a hop that is short or fast, never moving its leave time', () => {
    const fast = geometry([0, 1500])
    const over = { geometry: fast, segments: { '101N>102N': 100 }, stopId: '102N' }
    const shifted = plan(over, 30)
    expect(shifted.dwellS).toBeCloseTo(dwellFor(100) + 10, 9)
    expect(leaveAt(shifted)).toBeCloseTo(leaveAt(plan(over)), 9)
    expect(1500 / (shifted.runS - shifted.dwellS)).toBeLessThanOrEqual(MAX_CRUISE_MPS + 1e-9)
    const brief = plan({ geometry: geometry([0, 300]), segments: { '101N>102N': 40 } }, 30)
    expect(brief.dwellS).toBeCloseTo(dwellFor(40) + ARRIVAL_SHIFT_MAX_SHARE * (40 - dwellFor(40)), 9)
  })

  it('arrives at the shifted time, and never runs above 25 m/s on average', () => {
    const shifted = plan({}, 20)
    expect(hopFraction(shifted, shifted.arriveAt!)).toBe(1)
    expect(1000 / (shifted.runS - shifted.dwellS)).toBeLessThanOrEqual(MAX_CRUISE_MPS)
    // At the unshifted leave time the train has not moved; it never goes back.
    expect(hopFraction(shifted, leaveAt(shifted))).toBe(0)
  })

  it('leaves plans with no time to shift alone: a held terminal, an overdue train, a stop to stand at', () => {
    const terminal = plan({ status: 'STOPPED_AT', stopId: '103N', arrivals: [] }, 25)
    expect(terminal).toMatchObject({ arriveAt: null, fixedFraction: 0, dwellS: dwellFor(terminal.runS) })
    const overdue = plan({ status: null, stopId: null, arrivals: [['102N', NOW - 50], ['103N', NOW - 10]] }, 25)
    expect(overdue).toMatchObject({ arriveAt: null, fixedFraction: 1, dwellS: dwellFor(overdue.runS) })
    expect(plan({ status: 'STOPPED_AT', stopId: '101N', arrivals: [['101N', NOW + 20]] }, 25).arriveAt).toBeNull()
  })

  it('defaults to no shift', () => {
    expect(plan({}, undefined)).toEqual(plan({}, 0))
  })
})
