import { describe, expect, it } from 'vitest'
import type { Arrival, RealtimeTrip, VehicleStatus } from '../../data/realtime'
import { buildPolyline } from './polyline'
import { planHop, type HopPlan } from './position'
import type { ShapeGeometry } from './shapeGeometry'
import { MAX_PULL_IN_S, nextVisit, SCHEDULE_CAP_SLACK_S as SLACK, type StopVisit } from './stopVisit'
import { EMPTY_PROFILE } from '../trackProfile'

const NOW = 1_795_228_554
const H = NOW - 5 // the feed header

function rt(status: VehicleStatus | null, stopId: string | null, timestamp: number | null, arrivals: Arrival[]): RealtimeTrip {
  return { route: '1', direction: 'N', tripId: 't', startDate: null, trainId: null, assigned: true, stopId, status, timestamp, arrivals }
}

describe('nextVisit', () => {
  it('on a feed that leaves STOPPED_AT on departure, places the train at the platform as of the header', () => {
    expect(nextVisit(null, rt('STOPPED_AT', '102N', NOW - 30, [['102N', NOW - 30]]), '1234567', H)).toEqual({
      stopId: '102N',
      arrivedAt: NOW - 30,
      leftAfter: H,
      here: true,
    })
  })

  it('takes the stop’s own predicted time as the earliest departure when it is later than the header', () => {
    expect(nextVisit(null, rt('STOPPED_AT', 'L06N', NOW - 10, [['L06N', NOW + 30]]), 'l', H)?.leftAfter).toBe(NOW + 30)
  })

  it('keeps the earliest arrival and the latest time at the platform across polls at the same stop', () => {
    const first: StopVisit = { stopId: '102N', arrivedAt: NOW - 30, leftAfter: NOW - 25, here: true }
    expect(nextVisit(first, rt('STOPPED_AT', '102N', NOW - 28, []), 'l', H)).toEqual({ stopId: '102N', arrivedAt: NOW - 30, leftAfter: H, here: true })
  })

  it('starts over at a new stop', () => {
    const first: StopVisit = { stopId: '101N', arrivedAt: NOW - 200, leftAfter: NOW - 150, here: false }
    expect(nextVisit(first, rt('STOPPED_AT', '102N', NOW - 10, []), '1234567', H)).toEqual({ stopId: '102N', arrivedAt: NOW - 10, leftAfter: H, here: true })
  })

  it('keeps the visit through any other status, no longer at the platform', () => {
    const first: StopVisit = { stopId: '102N', arrivedAt: NOW - 30, leftAfter: NOW - 25, here: true }
    expect(nextVisit(first, rt('IN_TRANSIT_TO', '103N', NOW, []), '1234567', H)).toEqual({ ...first, here: false })
    const gone = { ...first, here: false }
    expect(nextVisit(gone, rt(null, '103N', null, []), 'l', H)).toBe(gone)
    expect(nextVisit(null, rt('STOPPED_AT', '102N', null, []), '1234567', H)).toBeNull()
  })

  it('on a feed whose STOPPED_AT lingers, dates only the arrival unless the stop’s own time is still ahead', () => {
    const first = nextVisit(null, rt('STOPPED_AT', 'A15N', NOW - 60, [['A15N', NOW - 60]]), 'ace', H)
    expect(first).toEqual({ stopId: 'A15N', arrivedAt: NOW - 60, leftAfter: null, here: false })
    expect(nextVisit(first, rt('STOPPED_AT', 'A15N', NOW - 10, [['A15N', NOW - 10]]), 'ace', H)).toEqual(first)
    expect(nextVisit(first, rt('STOPPED_AT', 'A15N', NOW - 10, [['A15N', NOW + 20]]), 'ace', H)).toEqual({ ...first, leftAfter: NOW + 20, here: true })
  })
})

const northbound: ShapeGeometry = {
  shapeId: '1..N03R',
  line: buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: 0, z: -2000 }]),
  stops: ['101N', '102N', '103N'],
  stopDistances: [0, 1000, 2000],
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
  bandInputs: new Float32Array(0),
}
// A 100 s hop, 30 s of it dwelling at the origin.
const SEGMENTS = { '101N>102N': 100, '102N>103N': 100 }

function plan(status: VehicleStatus, stopId: string, arrivals: Arrival[], visit: StopVisit | null): HopPlan {
  const p = planHop({ geometry: northbound, status, stopId, arrivals, segments: SEGMENTS, now: NOW, visit })
  if ('ok' in p) throw new Error(p.reason)
  return p
}

describe('planHop caps a late prediction with the schedule from the last stop', () => {
  const left = (arrivedAt: number, leftAfter: number | null = null): StopVisit => ({ stopId: '102N', arrivedAt, leftAfter, here: false })

  it('takes the arrival at the last stop plus the run and the slack when that is sooner than the prediction', () => {
    // At 102N since NOW - 60, so due at 103N at NOW + 40 (plus the slack); the feed says NOW + 80.
    const p = plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], left(NOW - 60))
    expect(p.arriveAt).toBe(NOW + 40 + SLACK)
    expect(p.capped).toBe(true)
  })

  it('keeps the prediction when it is the sooner', () => {
    const p = plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 20]], left(NOW - 60))
    expect(p.arriveAt).toBe(NOW + 20)
    expect(p.capped).toBe(false)
  })

  it('never has a train leave before it was last known at the platform', () => {
    // Arrived at NOW - 60 but still there at NOW - 10: it can't be at 103N before NOW - 10 + 70.
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 100]], left(NOW - 60, NOW - 10)).arriveAt).toBe(NOW + 60 + SLACK)
  })

  it('leaves the prediction alone while the poll still places the train at that platform', () => {
    const here: StopVisit = { stopId: '102N', arrivedAt: NOW - 200, leftAfter: H, here: true }
    expect(plan('STOPPED_AT', '102N', [['103N', NOW + 120]], here).arriveAt).toBe(NOW + 120)
  })

  it(`pulls a prediction in by at most ${MAX_PULL_IN_S} s, so a hold the feed can't show isn't minutes early`, () => {
    // A lingering-feed train seen at 102N ten minutes ago, now predicted at 103N in 5 minutes.
    expect(plan('STOPPED_AT', '102N', [['103N', NOW + 300]], left(NOW - 600)).arriveAt).toBe(NOW + 300 - MAX_PULL_IN_S)
  })

  it('ignores a visit to any stop but the one the hop leaves, and never caps a hop from the origin', () => {
    const elsewhere: StopVisit = { stopId: '101N', arrivedAt: NOW - 300, leftAfter: null, here: false }
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], elsewhere).arriveAt).toBe(NOW + 80)
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], null).arriveAt).toBe(NOW + 80)
    // Laid over at the origin since long ago: the layover says nothing about when it leaves.
    expect(plan('IN_TRANSIT_TO', '102N', [['102N', NOW + 80]], elsewhere).arriveAt).toBe(NOW + 80)
  })
})
