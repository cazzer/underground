import { describe, expect, it } from 'vitest'
import type { Arrival, VehicleStatus } from '../../data/realtime'
import { buildPolyline } from './polyline'
import { dwellFor, DWELL_S, hopDistance, planHop, positionAlongShape, type PositionResult } from './position'
import type { ShapeGeometry } from './shapeGeometry'
import { EMPTY_PROFILE } from '../trackProfile'

const NOW = 1_795_228_554

const northbound: ShapeGeometry = {
  shapeId: '1..N03R',
  line: buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: 0, z: -2000 }]),
  stops: ['101N', '102N', '103N'],
  stopDistances: [0, 1000, 2000],
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
}
const southbound: ShapeGeometry = {
  shapeId: '1..S03R',
  line: buildPolyline([{ x: 0, z: -2000 }, { x: 0, z: -1000 }, { x: 0, z: 0 }]),
  stops: ['103S', '102S', '101S'],
  stopDistances: [0, 1000, 2000],
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
}
// A 100 s hop includes a 30 s dwell at its origin, so the train moves for the last 70 s.
const SEGMENTS = { '101N>102N': 100, '102N>103N': 100 }

function at(
  status: VehicleStatus | null,
  stopId: string | null,
  arrivals: Arrival[],
  opts: { geometry?: ShapeGeometry; segments?: Record<string, number> } = {},
): PositionResult {
  return positionAlongShape({
    geometry: opts.geometry ?? northbound,
    status,
    stopId,
    arrivals,
    segments: opts.segments ?? SEGMENTS,
    now: NOW,
  })
}
function ok(r: PositionResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`)
  return r
}

describe('positionAlongShape STOPPED_AT', () => {
  it('dwells at the platform while the next arrival is far off', () => {
    expect(ok(at('STOPPED_AT', '102N', [['103N', NOW + 150]])).distance).toBeCloseTo(1000)
  })
  it('moves on when the status lags behind the next arrival', () => {
    expect(ok(at('STOPPED_AT', '102N', [['103N', NOW + 35]])).distance).toBeCloseTo(1500)
  })
  it('stays at the stop with no arrival for the next stop', () => {
    const r = ok(at('STOPPED_AT', '102N', []))
    expect(r.distance).toBe(1000)
    expect(r.departsInS).toBeNull()
  })
  it('stays at the terminal', () => {
    expect(ok(at('STOPPED_AT', '103N', [])).distance).toBe(2000)
  })
})

describe('positionAlongShape in transit', () => {
  it('interpolates toward the next stop', () => {
    const r = ok(at('IN_TRANSIT_TO', '103N', [['103N', NOW + 17.5]]))
    expect(r.distance).toBeCloseTo(1750)
    expect(r.point.x).toBeCloseTo(0)
    expect(r.point.z).toBeCloseTo(-1750)
    expect(r.heading).toBeCloseTo(0)
    expect([r.fromIndex, r.toIndex]).toEqual([1, 2])
  })
  it('waits at the next platform when overdue', () => {
    expect(ok(at('IN_TRANSIT_TO', '103N', [['103N', NOW - 10]])).distance).toBeCloseTo(2000)
  })
  it('holds at the previous stop when the arrival is far off', () => {
    expect(ok(at('IN_TRANSIT_TO', '103N', [['103N', NOW + 500]])).distance).toBeCloseTo(1000)
  })
  it('floors INCOMING_AT at 75% of the hop', () => {
    expect(ok(at('INCOMING_AT', '103N', [['103N', NOW + 80]])).distance).toBeCloseTo(1750)
    expect(ok(at('INCOMING_AT', '103N', [['103N', NOW + 7]])).distance).toBeCloseTo(1900)
  })
  it('falls back to a run time from distance when the segment is unknown', () => {
    // 1000 m at 8 m/s = 125 s, 30 s of it dwell, so it moves for 95 s; 47.5 s left is halfway.
    const r = ok(at('IN_TRANSIT_TO', '102N', [['102N', NOW + 47.5]], { segments: {} }))
    expect(r.distance).toBeCloseTo(500)
  })
  it('reports how long until a train still at its origin departs', () => {
    const r = ok(at('IN_TRANSIT_TO', '101N', [['101N', NOW + 90]]))
    expect(r.distance).toBe(0)
    expect(r.departsInS).toBeCloseTo(90)
  })
})

describe('positionAlongShape without a status', () => {
  it('uses the first upcoming arrival as the next stop', () => {
    const r = ok(at(null, null, [['101N', NOW - 30], ['102N', NOW + 35], ['103N', NOW + 150]]))
    expect(r.distance).toBeCloseTo(500)
    expect(r.departsInS).toBeNull()
  })
  it('sits at the origin when every arrival is ahead', () => {
    const r = ok(at(null, null, [['101N', NOW + 300], ['102N', NOW + 400]]))
    expect(r.distance).toBe(0)
    expect(r.departsInS).toBeCloseTo(300)
  })
  it('parks at the last stop when every arrival is past', () => {
    expect(ok(at(null, null, [['102N', NOW - 60], ['103N', NOW - 20]])).distance).toBeCloseTo(2000)
  })
  it('ignores arrivals for stops off the pattern', () => {
    expect(ok(at(null, null, [['Z99N', NOW + 10], ['103N', NOW + 17.5]])).distance).toBeCloseTo(1750)
  })
})

describe('positionAlongShape failures and direction', () => {
  it('rejects a stop that is not on the pattern', () => {
    expect(at('IN_TRANSIT_TO', 'Z99N', [['Z99N', NOW + 10]])).toEqual({ ok: false, reason: 'off-pattern' })
    expect(at('STOPPED_AT', 'Z99N', [])).toEqual({ ok: false, reason: 'off-pattern' })
    expect(at(null, null, [['Z99N', NOW + 10]])).toEqual({ ok: false, reason: 'off-pattern' })
  })
  it('rejects an in-transit train with no arrival for its stop', () => {
    expect(at('IN_TRANSIT_TO', '103N', [['102N', NOW + 10]])).toEqual({ ok: false, reason: 'no-arrival' })
  })
  it('heads south on a southbound shape', () => {
    const r = ok(
      at('IN_TRANSIT_TO', '101S', [['101S', NOW + 35]], {
        geometry: southbound,
        segments: { '102S>101S': 100 },
      }),
    )
    expect(r.distance).toBeCloseTo(1500)
    expect(r.heading).toBeCloseTo(Math.PI)
  })
})

describe('planHop and hopDistance', () => {
  const cases: [string, VehicleStatus | null, string | null, Arrival[], { segments?: Record<string, number> }?][] = [
    ['dwelling', 'STOPPED_AT', '102N', [['103N', NOW + 150]]],
    ['status lag', 'STOPPED_AT', '102N', [['103N', NOW + 35]]],
    ['terminal', 'STOPPED_AT', '103N', []],
    ['in transit', 'IN_TRANSIT_TO', '103N', [['103N', NOW + 17.5]]],
    ['overdue', 'IN_TRANSIT_TO', '103N', [['103N', NOW - 10]]],
    ['far off', 'IN_TRANSIT_TO', '103N', [['103N', NOW + 500]]],
    ['incoming floor', 'INCOMING_AT', '103N', [['103N', NOW + 80]]],
    ['incoming late', 'INCOMING_AT', '103N', [['103N', NOW + 7]]],
    ['unknown segment', 'IN_TRANSIT_TO', '102N', [['102N', NOW + 47.5]], { segments: {} }],
    ['at origin', 'IN_TRANSIT_TO', '101N', [['101N', NOW + 90]]],
    ['no status', null, null, [['101N', NOW - 30], ['102N', NOW + 35], ['103N', NOW + 150]]],
    ['all past', null, null, [['102N', NOW - 60], ['103N', NOW - 20]]],
  ]

  it.each(cases)('%s: evaluating the plan matches positionAlongShape', (_name, status, stopId, arrivals, opts) => {
    const input = { geometry: northbound, status, stopId, arrivals, segments: opts?.segments ?? SEGMENTS, now: NOW }
    const plan = planHop(input)
    if ('ok' in plan) throw new Error(`unexpected ${plan.reason}`)
    expect(hopDistance(plan, northbound, NOW)).toBe(ok(positionAlongShape(input)).distance)
    // With a VehiclePosition the hop doesn't depend on `now`, so a later frame matches a fresh call.
    if (status !== null) {
      for (const k of [7, 40, 400]) {
        expect(hopDistance(plan, northbound, NOW + k), `NOW+${k}`).toBe(ok(positionAlongShape({ ...input, now: NOW + k })).distance)
      }
    }
  })

  it('advances with time without re-planning', () => {
    const arrivals: Arrival[] = [['103N', NOW + 70]]
    const plan = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '103N', arrivals, segments: SEGMENTS, now: NOW })
    if ('ok' in plan) throw new Error('unexpected failure')
    expect(hopDistance(plan, northbound, NOW)).toBeCloseTo(1000)
    expect(hopDistance(plan, northbound, NOW + 35)).toBeCloseTo(1500)
    expect(hopDistance(plan, northbound, NOW + 80)).toBeCloseTo(2000)
  })

  it('never moves backward as time passes, in any case', () => {
    for (const [name, status, stopId, arrivals, opts] of cases) {
      const plan = planHop({ geometry: northbound, status, stopId, arrivals, segments: opts?.segments ?? SEGMENTS, now: NOW })
      if ('ok' in plan) throw new Error(`unexpected ${plan.reason}`)
      let prev = -Infinity
      for (let t = 0; t <= 200; t += 0.5) {
        const d = hopDistance(plan, northbound, NOW + t)
        expect(d, `${name} at +${t}`).toBeGreaterThanOrEqual(prev)
        prev = d
      }
    }
  })

  it('passes failure reasons through', () => {
    const base = { geometry: northbound, segments: SEGMENTS, now: NOW }
    expect(planHop({ ...base, status: 'IN_TRANSIT_TO', stopId: 'Z99N', arrivals: [] })).toEqual({ ok: false, reason: 'off-pattern' })
    expect(planHop({ ...base, status: 'IN_TRANSIT_TO', stopId: '103N', arrivals: [] })).toEqual({ ok: false, reason: 'no-arrival' })
  })
})

describe('STOPPED_AT with no prediction for the next stop', () => {
  const stops = ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => `${s}N`)
  const line = buildPolyline(stops.map((_, i) => ({ x: 0, z: -i * 1000 })))
  const long: ShapeGeometry = { shapeId: 'L..N', line, stops, stopDistances: stops.map((_, i) => i * 1000), maxStopOffsetM: 0, profile: EMPTY_PROFILE }
  const plan = (stopId: string, arrivals: Arrival[]) =>
    planHop({ geometry: long, status: 'STOPPED_AT', stopId, arrivals, segments: {}, now: NOW })

  it('runs from the stop the train is at to the first predicted stop', () => {
    // At B (index 1) but the train's first prediction is E (index 4): it is on the hop B -> E.
    const p = plan('BN', [['EN', NOW + 40], ['FN', NOW + 100]])
    if ('ok' in p) throw new Error('unexpected failure')
    expect([p.from, p.to]).toEqual([1, 4])
  })
  it('still holds at the terminal and when there are no later arrivals', () => {
    for (const [stop, arrivals] of [['FN', [['EN', NOW + 40]]], ['BN', []], ['BN', [['AN', NOW + 40]]]] as [string, Arrival[]][]) {
      const p = plan(stop, arrivals)
      if ('ok' in p) throw new Error('unexpected failure')
      expect([p.from, p.to, p.fixedFraction]).toEqual([long.stops.indexOf(stop), long.stops.indexOf(stop), 0])
    }
  })
})

describe('dwell at the origin stop', () => {
  const hop = (arriveAt: number, segments: Record<string, number> = SEGMENTS) => {
    const plan = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '102N', arrivals: [['102N', arriveAt]], segments, now: NOW })
    if ('ok' in plan) throw new Error(`unexpected ${plan.reason}`)
    return plan
  }

  it('holds at the platform for the dwell, then runs and arrives on time', () => {
    const plan = hop(NOW + 100)
    expect(plan.dwellS).toBe(DWELL_S)
    for (const t of [0, 10, 29.9]) expect(hopDistance(plan, northbound, NOW + t), `+${t}`).toBe(0)
    expect(hopDistance(plan, northbound, NOW + 65)).toBeCloseTo(500)
    expect(hopDistance(plan, northbound, NOW + 100)).toBeCloseTo(1000)
    expect(hopDistance(plan, northbound, NOW + 130)).toBeCloseTo(1000)
  })

  it('caps the dwell at a share of a short hop and still arrives on time', () => {
    const plan = hop(NOW + 60, { '101N>102N': 60 })
    expect(plan.dwellS).toBeCloseTo(21)
    expect(hopDistance(plan, northbound, NOW + 20.9)).toBe(0)
    expect(hopDistance(plan, northbound, NOW + 40.5)).toBeCloseTo(500)
    expect(hopDistance(plan, northbound, NOW + 60)).toBeCloseTo(1000)
    expect(dwellFor(1000)).toBe(DWELL_S)
  })

  it('dwells on a fallback run time too', () => {
    const plan = hop(NOW + 125, {})
    expect(plan.runS).toBeCloseTo(125)
    expect(plan.dwellS).toBe(DWELL_S)
    expect(hopDistance(plan, northbound, NOW + 29)).toBe(0)
    expect(hopDistance(plan, northbound, NOW + 125)).toBeCloseTo(1000)
  })

  it('does not move the target across a stop when the next hop is planned 0 to 20 s later', () => {
    // Hop 1 ends at stop 1 at A; the train then dwells there and leaves for stop 2, due at A + 100.
    const A = NOW + 50
    const before = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '102N', arrivals: [['102N', A]], segments: SEGMENTS, now: NOW })
    if ('ok' in before) throw new Error('unexpected failure')
    const target = hopDistance(before, northbound, A)
    expect(target).toBeCloseTo(1000)
    const statuses: [VehicleStatus | null, string | null][] = [['STOPPED_AT', '102N'], ['IN_TRANSIT_TO', '103N'], ['INCOMING_AT', '103N'], [null, null]]
    for (const [status, stopId] of statuses) {
      for (let late = 0; late <= 20; late += 2) {
        const arrivals: Arrival[] = [['103N', A + 100]]
        const plan = planHop({ geometry: northbound, status, stopId, arrivals, segments: SEGMENTS, now: A + late })
        if ('ok' in plan) throw new Error(`unexpected ${plan.reason}`)
        // INCOMING_AT is floored at 75% of the hop on purpose; it never occurs this early in a real hop.
        if (status === 'INCOMING_AT') continue
        const moved = Math.abs(hopDistance(plan, northbound, A + late) - target)
        expect(moved, `${status} ${late}s late`).toBeLessThanOrEqual(50)
      }
    }
  })
})
