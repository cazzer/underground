import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NYC_BBOX,
  cacheKeyPath,
  isAddressLike,
  looksLikeBusiness,
  normalizeQuery,
  parseGeocodeRequest,
  type GeocodeQuery,
} from './geocodeQuery'

const parse = (qs: string) => parseGeocodeRequest(new URL(`https://w.example/geocode?${qs}`))
const ok = (qs: string): GeocodeQuery => {
  const r = parse(qs)
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`)
  return r.query
}

describe('normalizeQuery', () => {
  it('folds case, whitespace, width, curly apostrophes and invisible characters', () => {
    expect(normalizeQuery('  120   BROADWAY ')).toBe('120 broadway')
    expect(normalizeQuery('１２０ Ｂｒｏａｄｗａｙ')).toBe('120 broadway')
    expect(normalizeQuery('Katz’s ‘Deli')).toBe("katz's 'deli")
    expect(normalizeQuery('a\u202Ebc\u200Bd')).toBe('abcd')
    // A tab or newline is a word break, not nothing.
    expect(normalizeQuery('120\tBroadway')).toBe('120 broadway')
    expect(normalizeQuery('120\r\nBroadway\u200B ')).toBe('120 broadway')
    expect(normalizeQuery('a \u200B b')).toBe('a b')
  })
})

describe('parseGeocodeRequest', () => {
  it('bounds the length in code points after normalizing', () => {
    expect(parse('q=ab').ok).toBe(false)
    expect(parse('q=abc').ok).toBe(true)
    expect(parse(`q=${'a'.repeat(100)}`).ok).toBe(true)
    expect(parse(`q=${'a'.repeat(101)}`)).toEqual({ ok: false, error: 'bad-query' })
    // An emoji is one code point.
    expect(parse(`q=${encodeURIComponent('😀'.repeat(100))}`).ok).toBe(true)
    expect(parse(`q=${'a'.repeat(401)}`)).toEqual({ ok: false, error: 'bad-query' })
    expect(parse('')).toEqual({ ok: false, error: 'bad-query' })
    expect(parse('q=')).toEqual({ ok: false, error: 'bad-query' })
    expect(parse('q=%20%20%20%20')).toEqual({ ok: false, error: 'bad-query' })
  })

  it('rounds a focus inside the city to 2 decimals', () => {
    expect(ok('q=abc&focus=40.7306,-73.9866').focus).toEqual({ lat: 40.73, lon: -73.99 })
    expect(ok('q=abc').focus).toBeNull()
  })

  it('drops a focus outside the city, and refuses a malformed one', () => {
    expect(ok('q=abc&focus=41.5,-74').focus).toBeNull()
    expect(ok('q=abc&focus=0,0').focus).toBeNull()
    for (const bad of ['40.7', 'a,b', '40.7,-73.9,1', 'NaN,1', '1e3,2', '40.7,%20-73.9', ',']) {
      expect(parse(`q=abc&focus=${bad}`)).toEqual({ ok: false, error: 'bad-focus' })
    }
  })

  it('ignores other params', () => {
    expect(ok('q=abc&size=1000&lang=fr').text).toBe('abc')
  })
})

describe('cacheKeyPath', () => {
  it('is stable, and distinct per text and focus', () => {
    const a = cacheKeyPath(ok('q=120+Broadway&focus=40.73,-73.99'))
    expect(a).toBe('/geocode?v=2&q=120%20broadway&f=40.73,-73.99')
    expect(cacheKeyPath(ok('q=120+BROADWAY&focus=40.7301,-73.9899'))).toBe(a)
    expect(cacheKeyPath(ok('q=120+Broadway&focus=40.74,-73.99'))).not.toBe(a)
    expect(cacheKeyPath(ok('q=120+Broadway&focus=0,0'))).toBe('/geocode?v=2&q=120%20broadway&f=')
  })
})

describe('query heuristics', () => {
  it('isAddressLike wants a house number then a street', () => {
    expect(isAddressLike('120 broadway')).toBe(true)
    expect(isAddressLike('37-12 82 st')).toBe(true)
    expect(isAddressLike('12a main st')).toBe(true)
    expect(isAddressLike('barclays center')).toBe(false)
    expect(isAddressLike('120')).toBe(false)
  })

  it('looksLikeBusiness reads an apostrophe or a business word', () => {
    expect(looksLikeBusiness("katz's deli")).toBe(true)
    expect(looksLikeBusiness("joe's pizza")).toBe(true)
    expect(looksLikeBusiness('blue bottle coffee')).toBe(true)
    expect(looksLikeBusiness('barclays center')).toBe(false)
    expect(looksLikeBusiness('120 broadway')).toBe(false)
  })
})

describe('NYC_BBOX', () => {
  it('equals the basemap spec bbox', () => {
    const spec = JSON.parse(readFileSync(new URL('../../data/basemap/basemap.json', import.meta.url), 'utf8')) as {
      spec: { bbox: number[] }
    }
    expect([...NYC_BBOX]).toEqual(spec.spec.bbox)
  })
})
