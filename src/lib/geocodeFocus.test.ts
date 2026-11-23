import { beforeEach, describe, expect, it } from 'vitest'
import { NYC_BBOX } from '../data/realtime'
import { FIX_GUARD_M, focusParam, geocodeFocus } from './geocodeFocus'
import { placeFix, type MarkedPlacement } from './locate'
import { forgetLocate, locateMemoryFor, rememberLocate, type LocateMemory } from './locateMemory'
import type { Bounds, Station } from './network'
import { toGround, toLatLon, type Ground } from './projection'

const UNION_SQ = toGround({ lat: 40.7347, lon: -73.9906 })
const east = (g: Ground, m: number): Ground => ({ x: g.x + m, z: g.z })
const flewTo = (center: Ground, radiusM = 250, nearestId = 'A'): LocateMemory => ({ center, radiusM, nearestId })

function station(id: string, lat: number, lon: number): Station {
  return { id, name: id, pos: toGround({ lat, lon }), routeIds: [], stops: [], access: { status: 'none' }, leadId: id }
}
const stations = [station('A', 40.7347, -73.9906), station('B', 40.7527, -73.9772), station('C', 40.6926, -73.9871), station('D', 40.8296, -73.9262)]
const groups = new Map(stations.map((s) => [s.id, { ...s, memberIds: [s.id], otherNames: [] }]))
const bounds: Bounds = { minX: -12000, maxX: 12000, minZ: -22000, maxZ: 12000 }
const marked = (lat: number, lon: number, accuracyM = 30): MarkedPlacement => {
  const p = placeFix({ lat, lon, accuracyM }, stations, groups, bounds)
  if (!p || p.kind === 'outside') throw new Error('fixture fix is not marked')
  return p
}

describe('geocodeFocus', () => {
  it('prefers the station over the view and rounds to two decimals', () => {
    const f = geocodeFocus({ station: UNION_SQ, view: toGround({ lat: 40.8, lon: -73.9 }), fix: null, locate: [] })
    expect(f).toEqual({ lat: 40.73, lon: -73.99 })
    expect(geocodeFocus({ station: null, view: UNION_SQ, fix: null, locate: [] })).toEqual({ lat: 40.73, lon: -73.99 })
    expect(geocodeFocus({ station: null, view: null, fix: null, locate: [] })).toBeNull()
  })

  it('drops a candidate near a shown fix, and keeps one farther away', () => {
    const fix = marked(40.7347, -73.9906)
    expect(geocodeFocus({ station: null, view: east(fix.ground, 1000), fix, locate: [] })).toBeNull()
    expect(geocodeFocus({ station: null, view: east(fix.ground, FIX_GUARD_M + 500), fix, locate: [] })).not.toBeNull()
  })

  it('widens the guard to twice a far fix framing radius', () => {
    const fix: MarkedPlacement = { ...marked(40.7347, -73.9906), kind: 'far', viewRadiusM: 1600 }
    expect(geocodeFocus({ station: null, view: east(fix.ground, 3000), fix, locate: [] })).toBeNull()
    expect(geocodeFocus({ station: null, view: east(fix.ground, 3300), fix, locate: [] })).not.toBeNull()
  })

  it('holds a location flight guard with no fix shown', () => {
    const view = east(UNION_SQ, 500)
    expect(geocodeFocus({ station: null, view, fix: null, locate: [flewTo(UNION_SQ)] })).toBeNull()
    expect(geocodeFocus({ station: null, view: east(UNION_SQ, 4000), fix: null, locate: [flewTo(UNION_SQ)] })).not.toBeNull()
  })

  it('drops the station nearest the fix wherever it is, and no other station', () => {
    const far = toGround({ lat: 40.8296, lon: -73.9262 })
    expect(geocodeFocus({ station: far, stationId: 'D', view: far, fix: null, locate: [flewTo(UNION_SQ, 250, 'D')] })).toBeNull()
    expect(geocodeFocus({ station: far, stationId: 'D', view: far, fix: null, locate: [flewTo(UNION_SQ, 250, 'A')] })).not.toBeNull()
  })

  it('gives nothing outside the city', () => {
    expect(geocodeFocus({ station: null, view: toGround({ lat: 42.36, lon: -71.06 }), fix: null, locate: [] })).toBeNull()
  })

  it('never lets the fix out: for many fixes, the view and station the fix caused give nothing', () => {
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const [minLon, minLat, maxLon, maxLat] = NYC_BBOX
    let tested = 0
    for (let i = 0; i < 200; i++) {
      const lat = minLat + rand() * (maxLat - minLat)
      const lon = minLon + rand() * (maxLon - minLon)
      const placement = placeFix({ lat, lon, accuracyM: 20 + rand() * 400 }, stations, groups, bounds)
      if (!placement || placement.kind === 'outside') continue
      tested++
      const locate = [flewTo(placement.viewCenter, placement.viewRadiusM, placement.nearest.id)]
      expect(geocodeFocus({ station: null, view: placement.viewCenter, fix: placement, locate })).toBeNull()
      expect(geocodeFocus({ station: placement.nearest.pos, stationId: placement.nearest.id, view: placement.viewCenter, fix: placement, locate })).toBeNull()
      expect(geocodeFocus({ station: null, view: placement.viewCenter, fix: null, locate })).toBeNull()
      expect(geocodeFocus({ station: placement.nearest.pos, stationId: placement.nearest.id, view: placement.nearest.pos, fix: null, locate })).toBeNull()
    }
    expect(tested).toBeGreaterThan(20)
  })
})

describe('the location flight memory', () => {
  beforeEach(forgetLocate)

  it('locate, Go to the nearest station, clear the fix: a search still sends no focus near the fix', () => {
    const fix = marked(40.7347, -73.9906)
    // Locate: the flight, remembered.
    rememberLocate({ center: fix.viewCenter, radiusM: fix.viewRadiusM, nearestId: fix.nearest.id })
    // "Go to <nearest>" focuses the station (a station flight replaces the point flight), then the user clears the fix.
    const nearest = fix.nearest
    const ask = (view: Ground) =>
      geocodeFocus({ station: nearest.pos, stationId: nearest.id, view, fix: null, locate: locateMemoryFor(view) })
    expect(ask(nearest.pos)).toBeNull()
    expect(ask(east(nearest.pos, 100))).toBeNull()
    // Panning well away forgets it for good, so the view coming back is the user's own choice.
    expect(geocodeFocus({ station: null, view: east(fix.ground, 5000), fix: null, locate: locateMemoryFor(east(fix.ground, 5000)) })).not.toBeNull()
    expect(locateMemoryFor(fix.ground)).toEqual([])
  })

  it('holds with no camera target yet, and a new location flight replaces the memory', () => {
    rememberLocate(flewTo(UNION_SQ))
    expect(locateMemoryFor(null)).toHaveLength(1)
    const elsewhere = toGround({ lat: 40.83, lon: -73.93 })
    rememberLocate(flewTo(elsewhere, 250, 'D'))
    expect(locateMemoryFor(elsewhere).map((m) => m.nearestId)).toEqual(['D'])
  })
})

describe('focusParam', () => {
  it('is two decimals each, the form the Worker accepts', () => {
    expect(focusParam({ lat: 40.7, lon: -74 })).toBe('40.70,-74.00')
    expect(focusParam(toLatLon(UNION_SQ))).toMatch(/^-?\d{1,3}\.\d{2},-?\d{1,3}\.\d{2}$/)
  })
})
