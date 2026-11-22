import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '../data/realtime'
import { INITIAL_GEOCODE, type GeocodeMachine } from './geocodeSearch'
import { GEOCODE_ERROR_TEXT, geocodeAnnouncement, geocodeView, searchEmptyText } from './geocodeView'

const row = (label: string, kind: GeocodeResult['kind'], source: GeocodeResult['source']): GeocodeResult => ({ label, kind, source, lat: 40.7, lon: -74 })
const shown = (results: GeocodeResult[]) => ({ query: 'q', response: { version: 1 as const, results, attribution: {}, incomplete: false } })
const machine = (m: Partial<GeocodeMachine>): GeocodeMachine => ({ ...INITIAL_GEOCODE, query: 'q', ...m })

describe('geocodeView', () => {
  it('is off when disabled, short when idle', () => {
    expect(geocodeView(machine({ phase: 'settled' }), false, 0)).toEqual({ status: 'off' })
    expect(geocodeView(INITIAL_GEOCODE, true, 0)).toEqual({ status: 'short' })
  })

  it('drops street rows and lists only the sources of the rows kept', () => {
    const results = [row('A', 'street', 'geosearch'), row('B', 'place', 'photon'), row('C', 'area', 'photon')]
    const v = geocodeView(machine({ phase: 'settled', shown: shown(results) }), true, 0)
    expect(v).toMatchObject({ status: 'ready', sources: ['photon'] })
    expect(v.status === 'ready' && v.places.map((p) => p.label)).toEqual(['B', 'C'])
  })

  it('keeps the previous places while pending, with the tier only once loading', () => {
    const prev = shown([row('A', 'address', 'geosearch')])
    const debouncing = geocodeView(machine({ phase: 'debouncing', shown: prev }), true, 2)
    expect(debouncing).toMatchObject({ status: 'pending', tier: 0, sources: ['geosearch'] })
    expect(geocodeView(machine({ phase: 'loading', shown: prev }), true, 2)).toMatchObject({ status: 'pending', tier: 2 })
  })

  it('reports an error', () => {
    expect(geocodeView(machine({ phase: 'settled', error: 'busy' }), true, 0)).toEqual({ status: 'error', error: 'busy' })
  })
})

describe('geocodeAnnouncement', () => {
  const ready = (n: number) =>
    geocodeView(machine({ phase: 'settled', shown: shown(Array.from({ length: n }, (_, i) => row(`P${i}`, 'place', 'photon'))) }), true, 0)

  it('is silent while typing and loading quickly', () => {
    expect(geocodeAnnouncement({ status: 'short' })).toBe('')
    expect(geocodeAnnouncement({ status: 'off' })).toBe('')
    expect(geocodeAnnouncement({ status: 'pending', tier: 0, places: [], sources: [] })).toBe('')
    expect(geocodeAnnouncement({ status: 'pending', tier: 1, places: [], sources: [] })).toBe('')
  })

  it('speaks the slow tier, the count and the error once per state', () => {
    expect(geocodeAnnouncement({ status: 'pending', tier: 2, places: [], sources: [] })).toBe('Still searching addresses and places')
    expect(geocodeAnnouncement(ready(1))).toBe('1 address or place')
    expect(geocodeAnnouncement(ready(3))).toBe('3 addresses and places')
    expect(geocodeAnnouncement(ready(0))).toBe('No addresses or places match')
    expect(geocodeAnnouncement({ status: 'error', error: 'busy' })).toBe(GEOCODE_ERROR_TEXT.slice(0, -1))
    expect(geocodeAnnouncement(ready(3))).toBe(geocodeAnnouncement(ready(3)))
  })
})

describe('searchEmptyText', () => {
  const none = { status: 'ready', places: [], sources: [] } as const

  it('is null until typed and while stations match', () => {
    expect(searchEmptyText(false, 0, none)).toBeNull()
    expect(searchEmptyText(true, 2, none)).toBeNull()
  })

  it('names what was searched', () => {
    expect(searchEmptyText(true, 0, { status: 'off' })).toBe('No stations match.')
    expect(searchEmptyText(true, 0, { status: 'short' })).toBe('No stations match.')
    expect(searchEmptyText(true, 0, { status: 'error', error: 'busy' })).toBe('No stations match.')
    expect(searchEmptyText(true, 0, { status: 'pending', tier: 0, places: [], sources: [] })).toBeNull()
    expect(searchEmptyText(true, 0, none)).toBe('No stations or places match.')
    expect(searchEmptyText(true, 0, { status: 'ready', places: [row('A', 'place', 'photon')], sources: ['photon'] })).toBeNull()
  })
})
