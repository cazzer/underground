import { describe, expect, it } from 'vitest'
import { REFERENCE, toGround, toLatLon } from './projection'

describe('projection', () => {
  it('maps the reference point to the origin', () => {
    const g = toGround(REFERENCE)
    expect(g.x).toBeCloseTo(0, 6)
    expect(g.z).toBeCloseTo(0, 6)
  })

  it('puts north at negative z and east at positive x', () => {
    const north = toGround({ lat: REFERENCE.lat + 0.01, lon: REFERENCE.lon })
    const east = toGround({ lat: REFERENCE.lat, lon: REFERENCE.lon + 0.01 })
    expect(north.z).toBeLessThan(0)
    expect(north.x).toBeCloseTo(0, 6)
    expect(east.x).toBeGreaterThan(0)
    expect(east.z).toBeCloseTo(0, 6)
  })

  it('has about 111.2 km per degree of latitude', () => {
    const g = toGround({ lat: REFERENCE.lat + 1, lon: REFERENCE.lon })
    expect(-g.z).toBeGreaterThan(111_000)
    expect(-g.z).toBeLessThan(111_400)
  })

  it('shrinks longitude degrees by cos(latitude)', () => {
    const g = toGround({ lat: REFERENCE.lat, lon: REFERENCE.lon + 1 })
    expect(g.x).toBeGreaterThan(83_000)
    expect(g.x).toBeLessThan(85_000)
  })

  it('round-trips through toLatLon', () => {
    const p = { lat: 40.7359, lon: -73.9906 }
    const back = toLatLon(toGround(p))
    expect(back.lat).toBeCloseTo(p.lat, 9)
    expect(back.lon).toBeCloseTo(p.lon, 9)
  })
})
