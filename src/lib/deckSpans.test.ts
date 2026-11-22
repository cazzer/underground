import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { PackedDepthsFile, StationInterior } from '../data/stationSchema'
import { interiorDecks, trackDecks } from './interiorDecks'
import { buildNetwork } from './network'
import { deckSpans, memberSpans, platformSpans } from './platformSpan'
import { TRACK_OFFSET_M } from './trackOffset'

describe('span stop ids', () => {
  it('keep the first run\'s stop id through platformSpans and memberSpans', () => {
    const spans = platformSpans([
      ['a', [{ d0: 100, d1: 200, yReal: -10, stationId: 'S1', stopId: 'S1N' }, { d0: 300, d1: 350, yReal: -10, stationId: 'S1', stopId: 'S1X' }]],
      ['b', [{ d0: 10, d1: 20, yReal: -5, stationId: 'T1', stopId: 'T1S' }]],
    ])
    expect(spans.get('S1')!.get('a')).toEqual({ d0: 100, d1: 350, stopId: 'S1N' })
    const union = memberSpans(spans, ['S1', 'T1'])!
    expect(union.get('a')).toEqual({ d0: 100, d1: 350, stopId: 'S1N' })
    expect(union.get('b')).toEqual({ d0: 10, d1: 20, stopId: 'T1S' })
  })
})

describe('deckSpans', () => {
  const spans = new Map([
    ['a', { d0: 0, d1: 10, stopId: 'L1N' }],
    ['b', { d0: 0, d1: 10, stopId: 'U1N' }],
  ])
  const deckOf = new Map([['L1N', 0], ['U1N', 1]])

  it('is [null] for no spans and the same map for one deck or none', () => {
    expect(deckSpans(null, deckOf, 2)).toEqual([null])
    expect(deckSpans(spans, deckOf, 1)[0]).toBe(spans)
    expect(deckSpans(spans, new Map(), 0)[0]).toBe(spans)
  })

  it('splits the spans by deck, keeping the span objects', () => {
    const [low, high] = deckSpans(spans, deckOf, 2)
    expect([...low!.keys()]).toEqual(['a'])
    expect([...high!.keys()]).toEqual(['b'])
    expect(high!.get('b')).toBe(spans.get('b'))
  })

  it('puts a span whose stop has no deck with the shallowest, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const odd = new Map([['c', { d0: 0, d1: 10, stopId: 'Q9N' }], ['d', { d0: 0, d1: 10 }]])
    const out = deckSpans(odd, deckOf, 2)
    deckSpans(odd, deckOf, 2)
    expect([...out[1]!.keys()]).toEqual(['c', 'd'])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('Union Sq (635) deck spans, committed data', () => {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const stationsFile = readJson('../../public/data/stations.json') as StationsFile
  const routesFile = readJson('../../public/data/routes.json') as RoutesFile
  const shapesFile = readJson('../../public/data/shapes.json') as ShapesFile
  const packed = readJson('../../public/data/station-depths.json') as PackedDepthsFile
  const union = readJson('../../public/data/stations/635.json') as StationInterior
  const network = buildNetwork(stationsFile, routesFile, shapesFile, TRACK_OFFSET_M, packed, 2)
  const decks = interiorDecks(union)
  const routeOf = (shapeId: string) => network.shapes.find((s) => s.id === shapeId)!.routeId

  it('lifts the L on the Canarsie deck and the Lexington and Broadway trains on the upper one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = memberSpans(network.platformSpans, union.memberStationIds!)!
    const [low, high] = deckSpans(all, trackDecks(union, decks), decks.length)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    expect(low!.size + high!.size).toBe(all.size)
    expect(new Set([...low!.keys()].map(routeOf))).toEqual(new Set(['L']))
    const upper = new Set([...high!.keys()].map(routeOf))
    expect(upper.has('L')).toBe(false)
    expect(upper.has('6')).toBe(true)
    expect(upper.has('N')).toBe(true)
  })
})
