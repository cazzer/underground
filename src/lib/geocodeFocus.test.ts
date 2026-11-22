import { describe, expect, it } from 'vitest'
import { NYC_BBOX } from '../data/realtime'
import type { FlyRequest } from './focus'
import { FIX_GUARD_M, focusParam, geocodeFocus } from './geocodeFocus'
import { placeFix, type MarkedPlacement } from './locate'
import type { Bounds, Station } from './network'
import { toGround, toLatLon, type Ground } from './projection'

const UNION_SQ = toGround({ lat: 40.7347, lon: -73.9906 })
const east = (g: Ground, m: number): Ground => ({ x: g.x + m, z: g.z })
const pointFly = (center: Ground, source: 'locate' | 'place', radiusM = 250): FlyRequest => ({ kind: 'point', center, radiusM, source, nonce: 1 })
const locateFly = (center: Ground, radiusM = 250) => pointFly(center, 'locate', radiusM)

function station(id: string, lat: number, lon: number): Station {
  return { id, name: id, pos: toGround({ lat, lon }), routeIds: [], stops: [], access: { status: 'none' } }
}
const stations = [station('A', 40.7347, -73.9906), station('B', 40.7527, -73.9772), station('C', 40.6926, -73.9871), station('D', 40.8296, -73.9262)]
const bounds: Bounds = { minX: -12000, maxX: 12000, minZ: -22000, maxZ: 12000 }
const marked = (lat: number, lon: number, accuracyM = 30): MarkedPlacement => {
  const p = placeFix({ lat, lon, accuracyM }, stations, bounds)
  if (!p || p.kind === 'outside') throw new Error('fixture fix is not marked')
  return p
}

describe('geocodeFocus', () => {
  it('prefers the station over the view and rounds to two decimals', () => {
    const f = geocodeFocus({ station: UNION_SQ, view: toGround({ lat: 40.8, lon: -73.9 }), fix: null, lastFly: null })
    expect(f).toEqual({ lat: 40.73, lon: -73.99 })
    expect(geocodeFocus({ station: null, view: UNION_SQ, fix: null, lastFly: null })).toEqual({ lat: 40.73, lon: -73.99 })
    expect(geocodeFocus({ station: null, view: null, fix: null, lastFly: null })).toBeNull()
  })

  it('drops a candidate near a shown fix, and keeps one farther away', () => {
    const fix = marked(40.7347, -73.9906)
    expect(geocodeFocus({ station: null, view: east(fix.ground, 1000), fix, lastFly: null })).toBeNull()
    expect(geocodeFocus({ station: null, view: east(fix.ground, FIX_GUARD_M + 500), fix, lastFly: null })).not.toBeNull()
  })

  it('widens the guard to twice a far fix framing radius', () => {
    const fix: MarkedPlacement = { ...marked(40.7347, -73.9906), kind: 'far', viewRadiusM: 1600 }
    expect(geocodeFocus({ station: null, view: east(fix.ground, 3000), fix, lastFly: null })).toBeNull()
    expect(geocodeFocus({ station: null, view: east(fix.ground, 3300), fix, lastFly: null })).not.toBeNull()
  })

  it('holds a location flight guard with no fix shown, until another flight replaces it', () => {
    const view = east(UNION_SQ, 500)
    expect(geocodeFocus({ station: null, view, fix: null, lastFly: locateFly(UNION_SQ) })).toBeNull()
    expect(geocodeFocus({ station: null, view, fix: null, lastFly: pointFly(UNION_SQ, 'place') })).not.toBeNull()
    expect(geocodeFocus({ station: null, view, fix: null, lastFly: { kind: 'station', stationId: 'A', nonce: 2 } })).not.toBeNull()
    expect(geocodeFocus({ station: null, view: east(UNION_SQ, 4000), fix: null, lastFly: locateFly(UNION_SQ) })).not.toBeNull()
  })

  it('gives nothing outside the city', () => {
    expect(geocodeFocus({ station: null, view: toGround({ lat: 42.36, lon: -71.06 }), fix: null, lastFly: null })).toBeNull()
  })

  it('never lets the fix out: for many fixes, the view and station the fix caused give nothing', () => {
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const [minLon, minLat, maxLon, maxLat] = NYC_BBOX
    let tested = 0
    for (let i = 0; i < 200; i++) {
      const lat = minLat + rand() * (maxLat - minLat)
      const lon = minLon + rand() * (maxLon - minLon)
      const placement = placeFix({ lat, lon, accuracyM: 20 + rand() * 400 }, stations, bounds)
      if (!placement || placement.kind === 'outside') continue
      tested++
      const fly = locateFly(placement.viewCenter, placement.viewRadiusM)
      expect(geocodeFocus({ station: null, view: placement.viewCenter, fix: placement, lastFly: fly })).toBeNull()
      expect(geocodeFocus({ station: placement.nearest.pos, view: placement.viewCenter, fix: placement, lastFly: fly })).toBeNull()
      expect(geocodeFocus({ station: null, view: placement.viewCenter, fix: null, lastFly: fly })).toBeNull()
    }
    expect(tested).toBeGreaterThan(20)
  })
})

describe('focusParam', () => {
  it('is two decimals each, the form the Worker accepts', () => {
    expect(focusParam({ lat: 40.7, lon: -74 })).toBe('40.70,-74.00')
    expect(focusParam(toLatLon(UNION_SQ))).toMatch(/^-?\d{1,3}\.\d{2},-?\d{1,3}\.\d{2}$/)
  })
})
