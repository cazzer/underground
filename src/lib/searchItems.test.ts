import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '../data/realtime'
import type { GeocodeView } from './geocodeView'
import { enterTarget, placeKind, searchItems } from './searchItems'

const station = (id: string) => ({ id, name: id, routeIds: [] })
const place = (label: string, kind: GeocodeResult['kind'], lat = 40.7, lon = -74): GeocodeResult => ({ label, kind, lat, lon, source: 'photon' })

describe('searchItems', () => {
  it('lists stations unchanged, then places, streets and intersections in the Worker\'s order, an area as a place', () => {
    const items = searchItems([station('B'), station('A')], [place('S', 'street'), place('X', 'intersection'), place('Home', 'address'), place('Soho', 'area')])
    expect(items.map((i) => i.kind)).toEqual(['station', 'station', 'street', 'intersection', 'address', 'place'])
    expect(items.map((i) => (i.kind === 'station' ? i.station.id : i.text.name))).toEqual(['B', 'A', 'S', 'X', 'Home', 'Soho'])
  })

  it('gives unique, id-safe keys, even for twins at one point', () => {
    const items = searchItems([station('L08')], [place('A', 'place', 40.12345, -74.5), place('A', 'place', 40.12345, -74.5)])
    const keys = items.map((i) => i.key)
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('maps kinds', () => {
    expect(placeKind('street')).toBe('street')
    expect(placeKind('intersection')).toBe('intersection')
    expect(placeKind('area')).toBe('place')
    expect(placeKind('address')).toBe('address')
  })
})

describe('enterTarget', () => {
  const pending: GeocodeView = { status: 'pending', tier: 0, places: [], sources: [] }
  const ready: GeocodeView = { status: 'ready', places: [], sources: [] }
  const places = [place('Home', 'address')]

  it('is the first row, whatever the lookup is doing, when it is a station (always the current text\'s)', () => {
    const items = searchItems([station('B')], places)
    expect(enterTarget(items, pending)).toBe(items[0])
    expect(enterTarget(items, ready)).toBe(items[0])
  })

  it('waits for the lookup to settle when the first row is a place, street or intersection of an earlier answer', () => {
    for (const kind of ['address', 'place', 'street', 'intersection'] as const) {
      const items = searchItems([], [place('X', kind)])
      expect(enterTarget(items, pending), kind).toBeNull()
      expect(enterTarget(items, ready), kind).toBe(items[0])
      expect(enterTarget(items, { status: 'off' }), kind).toBe(items[0])
    }
  })

  it('is null for no rows', () => {
    expect(enterTarget(searchItems([], []), ready)).toBeNull()
  })
})
