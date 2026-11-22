import { describe, expect, it } from 'vitest'
import { placeText } from './placeLabel'
import { directionsLabel, rowActions, rowName } from './searchRowActions'
import type { SearchItem } from './searchItems'
import type { SearchableStation } from './stationSearch'

const station: SearchItem<SearchableStation> = { kind: 'station', key: 's-1', station: { id: '1', name: '7 Av', routeIds: [] } }
const place = (label: string): SearchItem<SearchableStation> => {
  const result = { label, kind: 'address' as const, lat: 40.7, lon: -74, source: 'photon' as const }
  return { kind: 'address', key: 'p', result, text: placeText(result) }
}

describe('rowActions', () => {
  it('offers directions only where asked', () => {
    expect(rowActions(true)).toEqual(['choose', 'from', 'to'])
    expect(rowActions(false)).toEqual(['choose'])
  })
})

describe('rowName', () => {
  it('names a station, with its borough when the row shows one', () => {
    expect(rowName(station, null)).toBe('7 Av')
    expect(rowName(station, 'Brooklyn')).toBe('7 Av, Brooklyn')
  })
  it('names a place with or without detail', () => {
    expect(rowName(place('120 Broadway, Manhattan'), null)).toBe('120 Broadway, Manhattan')
    expect(rowName(place('Empire State Building'), null)).toBe('Empire State Building')
  })
})

describe('directionsLabel', () => {
  it('puts the visible word first in the name', () => {
    expect(directionsLabel('to', '7 Av, Brooklyn')).toBe('Directions to 7 Av, Brooklyn')
    expect(directionsLabel('from', '14 St-Union Sq')).toBe('Directions from 14 St-Union Sq')
  })
})
