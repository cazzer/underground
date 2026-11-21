import { describe, expect, it } from 'vitest'
import type { InteriorModel } from '../scene/interiorModel'
import { deriveInteriorLoad, interiorIdOf, type IndexLoad } from './interiorLoad'

const model = { stationId: 'L08' } as InteriorModel
const empty = () => undefined
const cached = (id: string) => (id === 'L08' ? model : undefined)
const ready: IndexLoad = { status: 'ready', index: { stations: { L08: { provenance: 'authored' } } } }

describe('interiorIdOf', () => {
  it('is the station id only when the index is ready and lists it', () => {
    expect(interiorIdOf('L08', ready)).toBe('L08')
    expect(interiorIdOf('L10', ready)).toBeNull()
    expect(interiorIdOf(null, ready)).toBeNull()
    expect(interiorIdOf('L08', { status: 'loading' })).toBeNull()
    expect(interiorIdOf('L08', { status: 'error', message: 'x' })).toBeNull()
  })

  it('ignores inherited object keys', () => {
    expect(interiorIdOf('toString', ready)).toBeNull()
    expect(interiorIdOf('__proto__', ready)).toBeNull()
  })
})

describe('deriveInteriorLoad', () => {
  it('is none without a station, even while the index loads', () => {
    expect(deriveInteriorLoad(null, ready, cached, null)).toEqual({ status: 'none' })
    expect(deriveInteriorLoad(null, { status: 'loading' }, cached, null)).toEqual({ status: 'none' })
  })

  it('is loading while the index loads, and an error when the index failed', () => {
    expect(deriveInteriorLoad('L08', { status: 'loading' }, cached, null)).toEqual({ status: 'loading' })
    expect(deriveInteriorLoad('L08', { status: 'error', message: 'HTTP 404' }, cached, null)).toEqual({ status: 'error', message: 'HTTP 404' })
  })

  it('is none for a station the index does not list', () => {
    expect(deriveInteriorLoad('L10', ready, cached, null)).toEqual({ status: 'none' })
  })

  it('is ready from the cache, whatever the settled attempt says', () => {
    const error = { id: 'L08', load: { status: 'error' as const, message: 'HTTP 500' } }
    expect(deriveInteriorLoad('L08', ready, cached, error)).toEqual({ status: 'ready', model })
  })

  it('is loading until an attempt for this station settles', () => {
    expect(deriveInteriorLoad('L08', ready, empty, null)).toEqual({ status: 'loading' })
    const other = { id: 'L10', load: { status: 'error' as const, message: 'x' } }
    expect(deriveInteriorLoad('L08', ready, empty, other)).toEqual({ status: 'loading' })
  })

  it("shows this station's settled error", () => {
    const error = { id: 'L08', load: { status: 'error' as const, message: 'HTTP 500' } }
    expect(deriveInteriorLoad('L08', ready, empty, error)).toBe(error.load)
  })
})
