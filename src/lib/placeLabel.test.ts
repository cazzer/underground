import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '../data/realtime'
import type { Station } from './network'
import { displayCase, distanceText, nearNote, placePick, placeText, tripPlaceOf } from './placeLabel'
import { toGround } from './projection'

describe('displayCase', () => {
  it.each([
    ['120 BROADWAY', '120 Broadway'],
    ['1ST AVENUE', '1st Avenue'],
    ['W 14 ST', 'W 14 St'],
    ['37-12 82 ST', '37-12 82 St'],
    ["BARCLAY'S CENTER", "Barclay's Center"],
    ["O'NEILL PLAZA", "O'Neill Plaza"],
    ['MUSEUM OF THE CITY OF NEW YORK', 'Museum of the City of New York'],
    ['THE BATTERY', 'The Battery'],
    ['JFK AIRPORT', 'JFK Airport'],
    ['PS 321', 'PS 321'],
    ['WILKES-BARRE', 'Wilkes-Barre'],
    ['NYU LANGONE', 'NYU Langone'],
    ["ATLANTIC YARDS/BARCLAY'S CENTER", "Atlantic Yards/Barclay's Center"],
    ["ST MARK'S PL", "St Mark's Pl"],
    ['ASTOR PL', 'Astor Pl'],
    ['LYNCH ST', 'Lynch St'],
    ['ROCKEFELLER CTR', 'Rockefeller Ctr'],
    ['WASHINGTON HTS', 'Washington Hts'],
    ['AT&T BUILDING', 'AT&T Building'],
    ['LGA AIRPORT', 'LGA Airport'],
    ['NYC HEALTH', 'NYC Health'],
    ["B'WAY", "B'way"],
  ])('%s -> %s', (from, to) => expect(displayCase(from)).toBe(to))

  it('leaves a segment with any lowercase letter alone', () => {
    expect(displayCase("Katz's Delicatessen")).toBe("Katz's Delicatessen")
    expect(displayCase('Manhattan')).toBe('Manhattan')
    expect(displayCase('120')).toBe('120')
  })
})

const result = (label: string, kind: GeocodeResult['kind'] = 'address', lat = 40.7075, lon = -74.0113): GeocodeResult => ({ label, kind, lat, lon, source: 'geosearch' })

describe('placeText', () => {
  it('splits name and detail and builds the spoken name', () => {
    expect(placeText(result('120 BROADWAY, Manhattan'))).toEqual({
      name: '120 Broadway',
      detail: 'Manhattan',
      kindWord: 'Address',
      spoken: '120 Broadway, Manhattan, address',
    })
  })

  it('a place or area is a Place; no detail reads without a comma', () => {
    expect(placeText(result('Empire State Building', 'place'))).toMatchObject({ detail: null, kindWord: 'Place', spoken: 'Empire State Building, place' })
    expect(placeText(result('Chinatown, Manhattan', 'area')).kindWord).toBe('Place')
  })
})

describe('street and intersection rows', () => {
  const osm = (label: string, kind: 'street' | 'intersection'): GeocodeResult => ({ label, kind, lat: 40.71784, lon: -73.95773, source: 'osm' })

  it('read as "Name" over "Borough · Kind", spoken with the kind word, and keep their mixed-case names', () => {
    expect(placeText(osm('Bedford Av & N 7 St, Brooklyn', 'intersection'))).toEqual({
      name: 'Bedford Av & N 7 St',
      detail: 'Brooklyn',
      kindWord: 'Intersection',
      spoken: 'Bedford Av & N 7 St, Brooklyn, intersection',
    })
    expect(placeText(osm('W 40 St, Manhattan', 'street'))).toMatchObject({ name: 'W 40 St', detail: 'Manhattan', kindWord: 'Street', spoken: 'W 40 St, Manhattan, street' })
  })
})

describe('distanceText', () => {
  it('rounds to 50 m, then to 0.1 km', () => {
    expect(distanceText(40)).toBe('about 50 m')
    expect(distanceText(260)).toBe('about 250 m')
    expect(distanceText(1449)).toBe('about 1.4 km')
    expect(distanceText(996)).toBe('about 1 km')
  })
})

function station(id: string, name: string, lat: number, lon: number): Station {
  return { id, name, pos: toGround({ lat, lon }), routeIds: [], stops: [], access: { status: 'none' }, leadId: id }
}

describe('placePick', () => {
  const stations = [station('A', 'Wall St', 40.7074, -74.0113), station('B', 'Union Sq', 40.7347, -73.9906)]
  const groups = new Map(stations.map((s) => [s.id, { ...s, memberIds: [s.id], otherNames: [] }]))

  it('names the nearest station by straight line', () => {
    const r = result('120 BROADWAY, Manhattan')
    const pick = placePick(r, placeText(r), stations, groups)
    expect(pick).toMatchObject({ name: '120 Broadway', label: '120 Broadway, Manhattan', kind: 'address', nearest: { id: 'A' } })
    expect(pick?.nearest.distanceM).toBeLessThan(50)
  })

  it('names the complex when the nearest station is one of its members', () => {
    const member = { ...station('A2', 'Wall St Annex', 40.7075, -74.0114), leadId: 'A' }
    const group = { ...stations[0]!, memberIds: ['A', 'A2'], otherNames: ['Wall St Annex'] }
    const r = result('120 BROADWAY, Manhattan')
    const pick = placePick(r, placeText(r), [...stations, member], new Map([['A', group], ['A2', group]]))
    expect(pick?.nearest).toMatchObject({ id: 'A', name: 'Wall St' })
  })

  it('picks a street or intersection like any place: the point, the nearest station and the kind', () => {
    for (const kind of ['street', 'intersection'] as const) {
      const r: GeocodeResult = { label: 'Bedford Av & N 7 St, Brooklyn', kind, lat: 40.7074, lon: -74.0113, source: 'osm' }
      expect(placePick(r, placeText(r), stations, groups)).toMatchObject({ name: 'Bedford Av & N 7 St', label: 'Bedford Av & N 7 St, Brooklyn', kind, nearest: { id: 'A' } })
    }
  })

  it('words a trip end\'s "near" note: a street by its full label, anything else by its name', () => {
    const pick = (kind: 'street' | 'intersection' | 'address') => ({ kind, name: 'Broadway', label: 'Broadway, Brooklyn' })
    expect(nearNote(pick('street'))).toBe('Broadway, Brooklyn')
    expect(nearNote(pick('intersection'))).toBe('Broadway')
    expect(nearNote(pick('address'))).toBe('Broadway')
  })

  it("makes a trip place of a pick: the note and the place's own point (never a fix)", () => {
    const r = result('120 BROADWAY, Manhattan')
    const pick = placePick(r, placeText(r), stations, groups)!
    expect(tripPlaceOf(pick)).toEqual({ note: '120 Broadway', ground: pick.ground })
  })

  it('is null for an empty network', () => {
    const r = result('X')
    expect(placePick(r, placeText(r), [], groups)).toBeNull()
  })
})
