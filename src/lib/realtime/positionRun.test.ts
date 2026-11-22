// The run between stops after the dwell: eased (runEase.ts).
import { describe, expect, it } from 'vitest'
import { buildPolyline } from './polyline'
import { hopDistance, planHop } from './position'
import { MAX_CRUISE_MPS } from './runEase'
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
  bandInputs: new Float32Array(0),
}
// A 100 s hop includes a 30 s dwell at its origin, so the train moves for the last 70 s.
const SEGMENTS = { '101N>102N': 100, '102N>103N': 100 }

describe('the run after the dwell', () => {
  const plan = () => {
    const p = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '102N', arrivals: [['102N', NOW + 100]], segments: SEGMENTS, now: NOW })
    if ('ok' in p) throw new Error(`unexpected ${p.reason}`)
    return p
  }
  const DT = 0.01

  it('pulls away from rest, cruises at 1.25x the average, brakes to rest and arrives on time', () => {
    const p = plan()
    expect(p.rampShare).toBeCloseTo(0.2)
    // 1000 m over the 70 s after the 30 s dwell: 14.3 m/s on average.
    const average = 1000 / 70
    let prev = 0
    let peak = 0
    for (let k = 1; k <= 70 / DT; k++) {
      const d = hopDistance(p, northbound, NOW + 30 + k * DT)
      expect(d, `+${30 + k * DT}`).toBeGreaterThanOrEqual(prev)
      peak = Math.max(peak, (d - prev) / DT)
      prev = d
    }
    expect(peak).toBeLessThanOrEqual(1.25 * average * (1 + 1e-4)) // NOW + t rounds at epoch scale
    expect(peak).toBeGreaterThan(1.24 * average)
    expect(hopDistance(p, northbound, NOW + 30)).toBe(0)
    expect(hopDistance(p, northbound, NOW + 100)).toBe(1000)
    const speed = (t: number) => (hopDistance(p, northbound, NOW + t + DT) - hopDistance(p, northbound, NOW + t)) / DT
    expect(speed(30)).toBeLessThan(0.05)
    expect(speed(100 - DT)).toBeLessThan(0.05)
    expect(speed(65)).toBeCloseTo(1.25 * average, 3)
  })

  it('cruises no faster than 25 m/s on a fast hop, with shorter ramps, and still arrives on time', () => {
    // 70 s with a 24.5 s dwell: 1000 m in 45.5 s, 22 m/s average, which full ramps would cruise at 27.5 m/s.
    const p = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '102N', arrivals: [['102N', NOW + 70]], segments: { '101N>102N': 70 }, now: NOW })
    if ('ok' in p) throw new Error(`unexpected ${p.reason}`)
    let prev = 0
    let peak = 0
    for (let k = 1; k <= 45.5 / DT; k++) {
      const d = hopDistance(p, northbound, NOW + 24.5 + k * DT)
      expect(d).toBeGreaterThanOrEqual(prev)
      peak = Math.max(peak, (d - prev) / DT)
      prev = d
    }
    expect(peak).toBeLessThanOrEqual(MAX_CRUISE_MPS * (1 + 1e-4))
    expect(peak).toBeGreaterThan(MAX_CRUISE_MPS * 0.99)
    expect(hopDistance(p, northbound, NOW + 70)).toBe(1000)
  })

  it('eases an INCOMING_AT floor over the rest of the hop: pulls away from it at rest, arrives on time', () => {
    const p = planHop({ geometry: northbound, status: 'INCOMING_AT', stopId: '103N', arrivals: [['103N', NOW + 80]], segments: SEGMENTS, now: NOW })
    if ('ok' in p) throw new Error(`unexpected ${p.reason}`)
    expect(hopDistance(p, northbound, NOW + 10)).toBe(1750) // still in the dwell, held at the floor
    const speed = (t: number) => (hopDistance(p, northbound, NOW + t + DT) - hopDistance(p, northbound, NOW + t)) / DT
    expect(speed(10)).toBeLessThan(0.05)
    expect(speed(80 - DT)).toBeLessThan(0.05)
    let prev = 1750
    for (let k = 1; k <= 70 / DT; k++) {
      const d = hopDistance(p, northbound, NOW + 10 + k * DT)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
    expect(hopDistance(p, northbound, NOW + 80)).toBe(2000)
  })
})
