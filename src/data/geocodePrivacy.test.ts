import { beforeEach, describe, expect, it } from 'vitest'
import { FIX_GUARD_M, geocodeFocus } from '../lib/geocodeFocus'
import { placeFix, type MarkedPlacement } from '../lib/locate'
import { forgetLocate, locateMemoryFor, rememberLocate, rememberUnviewedFix } from '../lib/locateMemory'
import type { Bounds, Station } from '../lib/network'
import { toGround, type Ground, type LatLon } from '../lib/projection'
import { geocodeRequestUrl } from './geocodeFetch'
import { NYC_BBOX } from './realtime'

/**
 * The search dialog's "Use my location" gives the address search a fix to keep away from. Whatever the user did with
 * it (shown, hidden, flown to, found without a flight), the request builder gets no part of it: only `q` and, far from
 * the fix, the map's own rounded `focus`.
 */
const BASE = 'https://rt.example.workers.dev/geocode'
const QUERY = 'bedford av'
const GUARD_SLACK_M = 800 // two-decimal rounding moves a focus up to about 700 m

function station(id: string, lat: number, lon: number): Station {
  return { id, name: id, pos: toGround({ lat, lon }), routeIds: [], stops: [], access: { status: 'none' }, leadId: id }
}
const stations = [station('A', 40.7347, -73.9906), station('B', 40.7527, -73.9772), station('C', 40.6926, -73.9871), station('D', 40.8296, -73.9262)]
const groups = new Map(stations.map((s) => [s.id, { ...s, memberIds: [s.id], otherNames: [] }]))
const bounds: Bounds = { minX: -12000, maxX: 12000, minZ: -22000, maxZ: 12000 }

let seed = 11
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const east = (g: Ground, m: number): Ground => ({ x: g.x + m, z: g.z })
const distance = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

function randomFix(): { latLon: LatLon; placement: MarkedPlacement } | null {
  const [minLon, minLat, maxLon, maxLat] = NYC_BBOX
  const latLon = { lat: minLat + rand() * (maxLat - minLat), lon: minLon + rand() * (maxLon - minLon) }
  const placement = placeFix({ ...latLon, accuracyM: 20 + rand() * 400 }, stations, groups, bounds)
  return placement && placement.kind !== 'outside' ? { latLon, placement } : null
}

/** The URL a search builds for a view, as StationSearch's `focusFn` does. */
function urlFor(fix: MarkedPlacement | null, view: Ground, focusedId: string | null): string {
  const focused = stations.find((s) => s.id === focusedId) ?? null
  const focus = geocodeFocus({ station: focused?.pos ?? null, stationId: focusedId, view, fix, locate: locateMemoryFor(view) })
  return geocodeRequestUrl(BASE, QUERY, focus)
}

function expectNoFix(url: string, latLon: LatLon): void {
  const params = new URL(url).searchParams
  expect([...params.keys()].sort()).toEqual(['q'])
  expect(params.get('q')).toBe(QUERY)
  for (let places = 3; places <= 6; places++) {
    expect(url).not.toContain(latLon.lat.toFixed(places))
    expect(url).not.toContain(latLon.lon.toFixed(places))
  }
}

describe('a location fix never reaches a geocode request', () => {
  beforeEach(forgetLocate)

  it('(a) shown: the view at the fix, its framing center or within the guard, and its nearest station, send no focus', () => {
    let tested = 0
    for (let i = 0; i < 200; i++) {
      const f = randomFix()
      if (!f) continue
      tested++
      const { latLon, placement } = f
      const within = rand() * Math.max(FIX_GUARD_M, 2 * placement.viewRadiusM)
      for (const view of [placement.ground, placement.viewCenter, east(placement.ground, within)]) {
        expectNoFix(urlFor(placement, view, null), latLon)
        expectNoFix(urlFor(placement, view, placement.nearest.id), latLon)
      }
    }
    expect(tested).toBeGreaterThan(20)
  })

  it('(b) found without a flight, then hidden: the nearest station and the view near it send no focus, however far the view was', () => {
    let tested = 0
    for (let i = 0; i < 200; i++) {
      const f = randomFix()
      if (!f) continue
      tested++
      const { latLon, placement } = f
      forgetLocate()
      rememberUnviewedFix({ center: placement.viewCenter, radiusM: placement.viewRadiusM, nearestId: placement.nearest.id })
      // The view is far away when the nearest station gets focused (a "Go to" from a distance), then it arrives.
      const far = east(placement.nearest.pos, 15000)
      expectNoFix(urlFor(null, far, placement.nearest.id), latLon)
      expectNoFix(urlFor(null, placement.nearest.pos, placement.nearest.id), latLon)
      expectNoFix(urlFor(null, placement.viewCenter, null), latLon)
    }
    expect(tested).toBeGreaterThan(20)
  })

  it('(c) flown to, then hidden: the view over the fix and its nearest station send no focus', () => {
    let tested = 0
    for (let i = 0; i < 200; i++) {
      const f = randomFix()
      if (!f) continue
      tested++
      const { latLon, placement } = f
      forgetLocate()
      rememberLocate({ center: placement.viewCenter, radiusM: placement.viewRadiusM, nearestId: placement.nearest.id })
      expectNoFix(urlFor(null, placement.viewCenter, null), latLon)
      expectNoFix(urlFor(null, placement.nearest.pos, placement.nearest.id), latLon)
    }
    expect(tested).toBeGreaterThan(20)
  })

  it('(d) shown with the view far away: only the map\'s own rounded focus goes, far from the fix', () => {
    let withFocus = 0
    for (let i = 0; i < 200; i++) {
      const f = randomFix()
      if (!f) continue
      const { latLon, placement } = f
      forgetLocate()
      const guard = Math.max(FIX_GUARD_M, 2 * placement.viewRadiusM)
      const view = east(placement.ground, guard + 500 + rand() * 8000)
      const url = new URL(urlFor(placement, view, null))
      expect([...url.searchParams.keys()].every((k) => k === 'q' || k === 'focus')).toBe(true)
      expect(url.searchParams.get('q')).toBe(QUERY)
      for (let places = 3; places <= 6; places++) {
        expect(url.href).not.toContain(latLon.lat.toFixed(places))
        expect(url.href).not.toContain(latLon.lon.toFixed(places))
      }
      const focus = url.searchParams.get('focus')
      if (focus === null) continue
      withFocus++
      const [lat, lon] = focus.split(',').map(Number)
      expect(focus).toMatch(/^-?\d+\.\d{2},-?\d+\.\d{2}$/)
      expect(distance(toGround({ lat: lat!, lon: lon! }), placement.ground)).toBeGreaterThanOrEqual(FIX_GUARD_M - GUARD_SLACK_M)
    }
    expect(withFocus).toBeGreaterThan(5)
  })
})
