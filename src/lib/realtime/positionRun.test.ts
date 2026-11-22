// The run between stops after the dwell: eased (runEase.ts) by default, constant speed with `easedRuns: false`.
import { describe, expect, it } from 'vitest'
import { buildPolyline } from './polyline'
import { hopDistance, planHop } from './position'
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
  const plan = (easedRuns?: boolean) => {
    const p = planHop({ geometry: northbound, status: 'IN_TRANSIT_TO', stopId: '102N', arrivals: [['102N', NOW + 100]], segments: SEGMENTS, now: NOW, easedRuns })
    if ('ok' in p) throw new Error(`unexpected ${p.reason}`)
    return p
  }
  const DT = 0.01

  it('pulls away from rest, cruises at 1.25x the average, brakes to rest and arrives on time', () => {
    const p = plan()
    expect(p.eased).toBe(true)
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

  it('runs at constant speed with easedRuns false', () => {
    const p = plan(false)
    expect(p.eased).toBe(false)
    for (const [t, d] of [[30, 0], [37, 100], [65, 500], [93, 900], [100, 1000]]) {
      expect(hopDistance(p, northbound, NOW + t!), `+${t}`).toBeCloseTo(d!)
    }
  })
})
