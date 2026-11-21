import { describe, expect, it } from 'vitest'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { axisDifferenceDeg, fromUV, platformAxis, sampleRing, stationAxis, toUV } from './platformAxis.ts'
import { makeFrame } from './stationGeometry.ts'

const frameOf = (bearingDeg: number) => makeFrame({ anchor: { lat: 40.7, lon: -74 }, bearingDeg })
const rect = (bearingDeg: number, u: [number, number], v: [number, number]): LocalPoint[] => {
  const { fromUV: f } = frameOf(bearingDeg)
  return [f([u[0], v[0]]), f([u[1], v[0]]), f([u[1], v[1]]), f([u[0], v[1]])]
}

describe('toUV / fromUV', () => {
  it('agree with makeFrame.fromUV (u along the bearing, v to its right)', () => {
    for (const bearing of [0, 37, 90, 129.6, 175]) {
      const local = frameOf(bearing).fromUV([12, -3])
      const uv = toUV(local, { bearingDeg: bearing, origin: [0, 0] })
      expect(uv[0]).toBeCloseTo(12, 1)
      expect(uv[1]).toBeCloseTo(-3, 1)
      const back = fromUV([12, -3], { bearingDeg: bearing, origin: [5, 7] })
      expect(toUV(back, { bearingDeg: bearing, origin: [5, 7] })[0]).toBeCloseTo(12, 9)
    }
  })

  it('puts north on u at bearing 0 and east on v', () => {
    expect(toUV([0, -10], { bearingDeg: 0, origin: [0, 0] })[0]).toBeCloseTo(10, 9)
    expect(toUV([4, 0], { bearingDeg: 0, origin: [0, 0] })[1]).toBeCloseTo(4, 9)
  })
})

describe('platformAxis', () => {
  it.each([0, 20, 90, 129.6, 170])('finds the long axis of a platform at bearing %s', (bearing) => {
    const a = platformAxis(rect(bearing, [-70, 70], [-3, 3]))
    expect(axisDifferenceDeg(a.bearingDeg, bearing)).toBeLessThan(0.5)
    expect(a.lengthM).toBeCloseTo(140, 0)
  })
})

describe('axisDifferenceDeg', () => {
  it('is sign-free and wraps at 180', () => {
    expect(axisDifferenceDeg(179, 1)).toBeCloseTo(2, 9)
    expect(axisDifferenceDeg(10, 100)).toBe(90)
    expect(axisDifferenceDeg(30, 30)).toBe(0)
  })
})

describe('stationAxis', () => {
  it('averages bearings across the 180 wrap', () => {
    const a = stationAxis([rect(179, [-70, 70], [-3, 3]), rect(1, [-70, 70], [8, 14])])
    expect(axisDifferenceDeg(a.bearingDeg, 0)).toBeLessThan(0.7)
    expect(a.bearingDeg >= 0 && a.bearingDeg < 180).toBe(true)
  })

  it('weights by length, so a short crossing platform does not turn the axis', () => {
    const a = stationAxis([rect(40, [-70, 70], [-3, 3]), rect(40, [-70, 70], [8, 14]), rect(130, [-10, 10], [30, 34])])
    expect(axisDifferenceDeg(a.bearingDeg, 40)).toBeLessThan(10)
    expect(a.deviationsDeg[2]).toBeGreaterThan(70)
    expect(a.deviationsDeg[0]).toBeLessThan(10)
  })
})

describe('sampleRing', () => {
  it('samples about every meter, closing edge included', () => {
    const pts = sampleRing([[0, 0], [10, 0], [10, 4], [0, 4]])
    expect(pts.length).toBe(28)
    expect(pts.some((p) => p[0] === 0 && p[1] === 2)).toBe(true)
  })
})
