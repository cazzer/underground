import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { StationInterior as Interior } from '../data/stationSchema'
import { bandCutYs, interiorDecks, MAX_DECKS, strokeBandOf, trackDecks, trainRoofY } from './interiorDecks'
import { buildInteriorBuffers } from './interiorGeometry'
import { fixture, opts } from './interiorFixture'

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/stations/${f}`, import.meta.url), 'utf8')) as Interior

/** The fixture with platform tracks on `levels` extra levels below its own platform, each 6 m deeper. */
function deepFixture(extra: number): Interior {
  const base = fixture()
  for (let k = 1; k <= extra; k++) {
    base.levels.push({ id: `low${k}`, name: `Low ${k}`, kind: 'platform', y: -8 - 6 * k })
    base.platforms.push({ ...base.platforms[0]!, id: `P${k + 1}`, level: `low${k}`, tracks: [{ stopId: `Y0${k}N`, path: [[-25, 5], [25, 5]] }] })
  }
  return base
}

describe('interiorDecks', () => {
  it('is the platform level of a single-deck interior', () => {
    expect(interiorDecks(fixture())).toEqual([2])
  })

  it('lists two decks deepest first', () => {
    expect(interiorDecks(deepFixture(1))).toEqual([3, 2])
  })

  it('is empty when no platform has a track', () => {
    const base = fixture()
    expect(interiorDecks({ ...base, platforms: [{ ...base.platforms[0]!, tracks: [] }] })).toEqual([])
  })

  it(`keeps the shallowest ${MAX_DECKS} of 4 decks, warning once`, () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const four = { ...deepFixture(3), stationId: 'X04' }
    expect(interiorDecks(four)).toEqual([4, 3, 2])
    expect(interiorDecks(four)).toEqual([4, 3, 2])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('gives Union Sq (635) its two decks, the Canarsie platform then the Lexington and Broadway one', () => {
    const union = read('635.json')
    expect(interiorDecks(union).map((i) => union.levels[i]!.id)).toEqual(['platform-canarsie', 'platforms-upper'])
  })
})

describe('strokeBandOf', () => {
  it('is 0 everywhere with no decks', () => {
    expect([0, 1, 2, 3].map((i) => strokeBandOf(i, []))).toEqual([0, 0, 0, 0])
  })

  it('with one deck is the old split: the levels above it are band 1', () => {
    expect([0, 1, 2, 3].map((i) => strokeBandOf(i, [2]))).toEqual([1, 1, 0, 0])
  })

  it('counts the decks deeper than a level', () => {
    expect([0, 1, 2, 3].map((i) => strokeBandOf(i, [3, 2]))).toEqual([2, 2, 1, 0])
  })
})

describe('bandCutYs', () => {
  it("is each deck's train roof, rising for Union Sq's decks", () => {
    const union = read('635.json')
    const decks = interiorDecks(union)
    const cuts = bandCutYs(union, decks, 1.1, 2)
    expect(cuts).toEqual(decks.map((d) => trainRoofY(union.levels[d]!, 1.1, 2)))
    expect(cuts[0]!).toBeLessThan(cuts[1]!)
  })
})

describe('trackDecks', () => {
  it("puts Union Sq's L tracks on deck 0 and the Lexington and Broadway tracks on deck 1", () => {
    const union = read('635.json')
    const byStop = trackDecks(union, interiorDecks(union))
    expect(Object.fromEntries(byStop)).toEqual({ L03N: 0, L03S: 0, R20N: 1, R20S: 1, '635N': 1, '635S': 1 })
  })

  it('is deck 0 for every track with no decks (look C)', () => {
    expect([...trackDecks(read('635.json'), []).values()].every((d) => d === 0)).toBe(true)
  })
})

describe('shipped interiors', () => {
  it('have at most one deck and no bands between decks, except Union Sq', () => {
    const dir = new URL('../../public/data/stations/', import.meta.url)
    let checked = 0
    for (const f of readdirSync(dir)) {
      if (f === 'index.json' || !f.endsWith('.json')) continue
      const shipped = read(f)
      const decks = interiorDecks(shipped)
      checked++
      if (shipped.stationId === '635') continue
      expect(decks.length, shipped.stationId).toBeLessThanOrEqual(1)
      expect(buildInteriorBuffers(shipped, opts({ decks })).mid, shipped.stationId).toEqual([])
    }
    expect(checked).toBeGreaterThan(200)
  })
})
