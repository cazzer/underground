/** The committed index (worker/data/streetIndex.json) through the Worker's search. */
import { describe, expect, it } from 'vitest'
import { distanceM } from './geocodeMerge'
import { bundledStreetIndex } from './streetIndexData'
import { searchStreets } from './streetSearch'
import type { GeocodeQuery } from './geocodeQuery'

const STREET_INDEX = await bundledStreetIndex()
const search = (text: string, focus: GeocodeQuery['focus'] = null) => searchStreets(STREET_INDEX, { text, focus })
const labels = (text: string, focus: GeocodeQuery['focus'] = null) => {
  const { whole, partial } = search(text, focus)
  return [...whole, ...partial].map((c) => c.result.label)
}

describe('the committed street index', () => {
  it('loads once per isolate, on first use', async () => {
    expect(await bundledStreetIndex()).toBe(STREET_INDEX)
    expect(bundledStreetIndex()).toBe(bundledStreetIndex())
  })

  it('finds Bedford Av and N 7 St as one intersection, within 30 m of the crossing, in either order', () => {
    for (const text of ['bedford av & n 7', 'n 7 st and bedford av']) {
      const hit = [...search(text).whole, ...search(text).partial].find((c) => c.result.label === 'Bedford Av & N 7 St, Brooklyn')
      expect(hit?.result.kind, text).toBe('intersection')
      expect(distanceM({ lat: 40.71784, lon: -73.95773 }, hit!.result), text).toBeLessThan(30)
    }
  })

  it('finds W 40 St in Manhattan', () => {
    expect(labels('w 40 st')).toContain('W 40 St, Manhattan')
  })

  it('finds Broadway in four boroughs, the one nearest the focus first', () => {
    const boroughs = search('broadway').whole.map((c) => c.result.label)
    expect(boroughs.sort()).toEqual(expect.arrayContaining(['Broadway, Bronx', 'Broadway, Brooklyn', 'Broadway, Manhattan', 'Broadway, Queens']))
    expect(labels('broadway', { lat: 40.7, lon: -73.94 })[0]).toBe('Broadway, Brooklyn')
    expect(labels('broadway', { lat: 40.82, lon: -73.95 })[0]).not.toBe('Broadway, Brooklyn')
  })

  it('scores at most 120 streets for any query: no key lists more', () => {
    expect(Math.max(...[...STREET_INDEX.byKey.values()].map((ids) => ids.length))).toBeLessThanOrEqual(120)
  })

  it('keeps every candidate list short', () => {
    for (const text of ['b', 'av', 'st', 'the', 'w 1', 'broadway', 'n 7 & bedford', 'park', 'e 1']) {
      const { whole, partial } = search(text)
      expect(whole.length, text).toBeLessThanOrEqual(8)
      expect(partial.length, text).toBeLessThanOrEqual(8)
    }
  })

  it('writes every row inside the city with the OSM source', () => {
    for (const c of search('w 4').partial.concat(search('4 av & 9 st').partial, search('4 av & 9 st').whole)) {
      expect(c.result.source).toBe('osm')
      expect(c.result.lat).toBeGreaterThan(40.45)
      expect(c.result.lat).toBeLessThan(40.95)
      expect(c.result.label).toMatch(/, (Bronx|Manhattan|Brooklyn|Queens|Staten Island)$/)
    }
  })
})
