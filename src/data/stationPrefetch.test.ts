import { describe, expect, it } from 'vitest'
import type { IndexLoad } from './interiorLoad'
import { prefetchTargets } from './stationPrefetch'
import { MAX_PREFETCH_STATIONS } from '../lib/viewStations'

const listed = (...ids: string[]): IndexLoad => ({
  status: 'ready',
  index: { stations: Object.fromEntries(ids.map((id) => [id, { provenance: 'generated' as const }])) },
})
const many = Array.from({ length: 9 }, (_, i) => `S${i}`)

describe('prefetchTargets', () => {
  it('warms at most the cap plus two interiors, the focused file counted and left out', () => {
    const index = listed(...many)
    expect(prefetchTargets(many, null, index, 3).interiors).toEqual(['S0', 'S1', 'S2', 'S3', 'S4'])
    expect(prefetchTargets(many, 'S0', index, 3).interiors).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(prefetchTargets(many, null, index, 2).interiors).toEqual(['S0', 'S1', 'S2', 'S3'])
  })

  it('names a complex file once and skips stations the index lacks', () => {
    const index: IndexLoad = {
      status: 'ready',
      index: { stations: { '635': { provenance: 'authored' }, L03: { provenance: 'authored', file: '635' }, A02: { provenance: 'generated' } } },
    }
    expect(prefetchTargets(['L03', 'X99', '635', 'A02'], null, index, 3).interiors).toEqual(['635', 'A02'])
  })

  it('names no interior while the index loads or failed', () => {
    expect(prefetchTargets(many, null, { status: 'loading' }, 3).interiors).toEqual([])
    expect(prefetchTargets(many, null, { status: 'error', message: 'x' }, 3).interiors).toEqual([])
  })

  it('takes the street layers of up to six stations, the focused one counted and left out', () => {
    const index = listed()
    expect(prefetchTargets(many, null, index, 3).streets).toEqual(many.slice(0, MAX_PREFETCH_STATIONS))
    expect(prefetchTargets(many, 'S0', index, 3).streets).toEqual(many.slice(1, MAX_PREFETCH_STATIONS))
  })

  it('names only ids it was given, and nothing from an empty set', () => {
    const index = listed(...many)
    const t = prefetchTargets(['S3', 'S5'], null, index, 3)
    expect([...t.interiors, ...t.streets].every((id) => ['S3', 'S5'].includes(id))).toBe(true)
    const none = prefetchTargets([], 'S1', index, 3)
    expect(none.interiors).toEqual([])
    expect(none.streets).toEqual([])
  })
})
