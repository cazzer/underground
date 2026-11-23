import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '../data/realtime'
import { placeKind, searchItems } from './searchItems'

const station = (id: string) => ({ id, name: id, routeIds: [] })
const place = (label: string, kind: GeocodeResult['kind'], lat = 40.7, lon = -74): GeocodeResult => ({ label, kind, lat, lon, source: 'photon' })

describe('searchItems', () => {
  it('lists stations unchanged, then places, dropping streets and intersections for now and treating an area as a place', () => {
    const items = searchItems([station('B'), station('A')], [place('S', 'street'), place('X', 'intersection'), place('Home', 'address'), place('Soho', 'area')])
    expect(items.map((i) => i.kind)).toEqual(['station', 'station', 'address', 'place'])
    expect(items.map((i) => (i.kind === 'station' ? i.station.id : i.text.name))).toEqual(['B', 'A', 'Home', 'Soho'])
  })

  it('gives unique, id-safe keys, even for twins at one point', () => {
    const items = searchItems([station('L08')], [place('A', 'place', 40.12345, -74.5), place('A', 'place', 40.12345, -74.5)])
    const keys = items.map((i) => i.key)
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('maps kinds', () => {
    expect(placeKind('street')).toBeNull()
    expect(placeKind('intersection')).toBeNull()
    expect(placeKind('area')).toBe('place')
    expect(placeKind('address')).toBe('address')
  })
})
