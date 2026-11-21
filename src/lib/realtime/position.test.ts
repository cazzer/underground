import { describe, expect, it } from 'vitest'
import type { Arrival, VehicleStatus } from '../../data/realtime'
import { buildPolyline } from './polyline'
import { hopDistance, planHop, positionAlongShape, type PositionResult } from './position'
import type { ShapeGeometry } from './shapeGeometry'

const NOW = 1_795_228_554

const northbound: ShapeGeometry = {
  shapeId: '1..N03R',
  line: buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: 0, z: -2000 }]),
  stops: ['101N', '102N', '103N'],
  stopDistances: [0, 1000, 2000],
  maxStopOffsetM: 0,
}
const southbound: ShapeGeometry = {
  shapeId: '1..S03R',
  line: buildPolyline([{ x: 0, z: -2000 }, { x: 0, z: -1000 }, { x: 0, z: 0 }]),
  stops: ['103S', '102S', '101S'],
  stopDistances: [0, 1000, 2000],
  maxStopOffsetM: 0,
}
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
    expect(ok(at('STOPPED_AT', '102N', [['103N', NOW + 40]])).distance).toBeCloseTo(1600)
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
    const r = ok(at('IN_TRANSIT_TO', '103N', [['103N', NOW + 25]]))
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
    expect(ok(at('INCOMING_AT', '103N', [['103N', NOW + 5]])).distance).toBeCloseTo(1950)
  })
  it('falls back to a run time from distance when the segment is unknown', () => {
    // 1000 m at 8 m/s = 125 s; 62.5 s left is halfway.
    const r = ok(at('IN_TRANSIT_TO', '102N', [['102N', NOW + 62.5]], { segments: {} }))
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
    const r = ok(at(null, null, [['101N', NOW - 30], ['102N', NOW + 50], ['103N', NOW + 150]]))
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
    expect(ok(at(null, null, [['Z99N', NOW + 10], ['103N', NOW + 25]])).distance).toBeCloseTo(1750)
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
      at('IN_TRANSIT_TO', '101S', [['101S', NOW + 50]], {
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
    ['status lag', 'STOPPED_AT', '102N', [['103N', NOW + 40]]],
    ['terminal', 'STOPPED_AT', '103N', []],
    ['in transit', 'IN_TRANSIT_TO', '103N', [['103N', NOW + 25]]],
    ['overdue', 'IN_TRANSIT_TO', '103N', [['103N', NOW - 10]]],
    ['far off', 'IN_TRANSIT_TO', '103N', [['103N', NOW + 500]]],
    ['incoming floor', 'INCOMING_AT', '103N', [['103N', NOW + 80]]],
    ['incoming late', 'INCOMING_AT', '103N', [['103N', NOW + 5]]],
    ['unknown segment', 'IN_TRANSIT_TO', '102N', [['102N', NOW + 62.5]], { segments: {} }],
    ['at origin', 'IN_TRANSIT_TO', '101N', [['101N', NOW + 90]]],
    ['no status', null, null, [['101N', NOW - 30], ['102N', NOW + 50], ['103N', NOW + 150]]],
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
    const arrivals: Arrival[] = [['103N', NOW + 50]]
    const plan = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '103N', arrivals, segments: SEGMENTS, now: NOW })
    if ('ok' in plan) throw new Error('unexpected failure')
    expect(hopDistance(plan, northbound, NOW)).toBeCloseTo(1500)
    expect(hopDistance(plan, northbound, NOW + 25)).toBeCloseTo(1750)
    expect(hopDistance(plan, northbound, NOW + 80)).toBeCloseTo(2000)
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
  const long: ShapeGeometry = { shapeId: 'L..N', line, stops, stopDistances: stops.map((_, i) => i * 1000), maxStopOffsetM: 0 }
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
