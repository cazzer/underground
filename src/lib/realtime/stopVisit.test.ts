import { describe, expect, it } from 'vitest'
import type { Arrival, RealtimeTrip, VehicleStatus } from '../../data/realtime'
import { buildPolyline } from './polyline'
import { planHop, SCHEDULE_CAP_SLACK_S as SLACK, type HopPlan } from './position'
import type { ShapeGeometry } from './shapeGeometry'
import { nextVisit, type StopVisit } from './stopVisit'
import { EMPTY_PROFILE } from '../trackProfile'

const NOW = 1_795_228_554
const H = NOW - 5 // the feed header

function rt(status: VehicleStatus | null, stopId: string | null, timestamp: number | null, arrivals: Arrival[]): RealtimeTrip {
  return { route: '1', direction: 'N', tripId: 't', startDate: null, trainId: null, assigned: true, stopId, status, timestamp, arrivals }
}

describe('nextVisit', () => {
  it('dates the arrival from STOPPED_AT and, where the feed leaves it on departure, sees the train there as of the header', () => {
    expect(nextVisit(null, rt('STOPPED_AT', '102N', NOW - 30, [['102N', NOW - 30]]), '1234567', H)).toEqual({
      stopId: '102N',
      arrivedAt: NOW - 30,
      seenAt: H,
    })
  })

  it('keeps the earliest arrival and the latest sighting across polls at the same stop', () => {
    const first: StopVisit = { stopId: '102N', arrivedAt: NOW - 30, seenAt: NOW - 25 }
    expect(nextVisit(first, rt('STOPPED_AT', '102N', NOW - 28, []), 'l', H)).toEqual({ stopId: '102N', arrivedAt: NOW - 30, seenAt: H })
  })

  it('starts over at a new stop', () => {
    const first: StopVisit = { stopId: '101N', arrivedAt: NOW - 200, seenAt: NOW - 150 }
    expect(nextVisit(first, rt('STOPPED_AT', '102N', NOW - 10, []), '1234567', H)?.stopId).toBe('102N')
  })

  it('carries the visit through any other status, or a STOPPED_AT with no time', () => {
    const first: StopVisit = { stopId: '102N', arrivedAt: NOW - 30, seenAt: NOW - 25 }
    expect(nextVisit(first, rt('IN_TRANSIT_TO', '103N', NOW, []), '1234567', H)).toBe(first)
    expect(nextVisit(first, rt(null, '103N', null, []), 'l', H)).toBe(first)
    expect(nextVisit(null, rt('STOPPED_AT', '102N', null, []), '1234567', H)).toBeNull()
  })

  it('on a feed whose STOPPED_AT lingers, dates only the arrival: later polls prove nothing about the dwell', () => {
    const first = nextVisit(null, rt('STOPPED_AT', 'A15N', NOW - 60, [['A15N', NOW - 60]]), 'ace', H)
    expect(first).toEqual({ stopId: 'A15N', arrivedAt: NOW - 60, seenAt: NOW - 60 })
    expect(nextVisit(first, rt('STOPPED_AT', 'A15N', NOW - 10, [['A15N', NOW - 10]]), 'ace', H)).toEqual(first)
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
  const arrived = (arrivedAt: number, seenAt = arrivedAt): StopVisit => ({ stopId: '102N', arrivedAt, seenAt })

  it('takes the arrival at the last stop plus the run when that is sooner than the prediction', () => {
    // At 102N since NOW - 60, so due at 103N at NOW + 40 (plus the slack); the feed says NOW + 80.
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], arrived(NOW - 60)).arriveAt).toBe(NOW + 40 + SLACK)
  })

  it('keeps the prediction when it is the sooner', () => {
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 20]], arrived(NOW - 60)).arriveAt).toBe(NOW + 20)
  })

  it('never has a train that overstayed its dwell arrive sooner than its run from when it was last seen', () => {
    // Arrived at NOW - 60 but still at the platform at NOW - 10: it can't be at 103N before NOW - 10 + 70.
    expect(plan('STOPPED_AT', '102N', [['103N', NOW + 120]], arrived(NOW - 60, NOW - 10)).arriveAt).toBe(NOW + 60 + SLACK)
  })

  it('ignores a visit to any stop but the one the hop leaves', () => {
    const elsewhere: StopVisit = { stopId: '101N', arrivedAt: NOW - 300, seenAt: NOW - 300 }
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], elsewhere).arriveAt).toBe(NOW + 80)
    expect(plan('IN_TRANSIT_TO', '103N', [['103N', NOW + 80]], null).arriveAt).toBe(NOW + 80)
  })

  it('leaves a fixed plan alone', () => {
    // At the terminal with nothing ahead: held, no arrival to cap.
    const held = plan('STOPPED_AT', '103N', [], { stopId: '103N', arrivedAt: NOW - 10, seenAt: NOW })
    expect(held.arriveAt).toBeNull()
    expect(held.fixedFraction).toBe(0)
  })
})
