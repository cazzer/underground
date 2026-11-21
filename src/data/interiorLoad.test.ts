import { describe, expect, it } from 'vitest'
import type { InteriorModel } from '../scene/interiorModel'
import { deriveInteriorLoad, focusedMarkerShown, interiorIdOf, type IndexLoad, type InteriorLoad } from './interiorLoad'

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

  it('is none while the index loads or after it failed, so no station gets a false panel', () => {
    expect(deriveInteriorLoad('L08', { status: 'loading' }, cached, null)).toEqual({ status: 'none' })
    expect(deriveInteriorLoad('L08', { status: 'loading' }, empty, null)).toEqual({ status: 'none' })
    expect(deriveInteriorLoad('L10', { status: 'error', message: 'HTTP 404' }, empty, null)).toEqual({ status: 'none' })
    const error = { id: 'L08', load: { status: 'error' as const, message: 'HTTP 500' } }
    expect(deriveInteriorLoad('L08', { status: 'error', message: 'HTTP 404' }, empty, error)).toEqual({ status: 'none' })
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

describe('focusedMarkerShown', () => {
  const loading: InteriorLoad = { status: 'loading' }
  const none: InteriorLoad = { status: 'none' }
  const failed: InteriorLoad = { status: 'error', message: 'HTTP 500' }
  const done: InteriorLoad = { status: 'ready', model }
  it('hides the marker for an interior that is loading or ready', () => {
    expect(focusedMarkerShown('L08', ready, loading)).toBe(false)
    expect(focusedMarkerShown('L08', ready, done)).toBe(false)
  })
  it('shows it for a station with no interior and for a failed load', () => {
    expect(focusedMarkerShown('L10', ready, none)).toBe(true)
    expect(focusedMarkerShown('L08', ready, failed)).toBe(true)
  })
  it('shows it when the index failed (no interior will ever load) but not while the index loads', () => {
    expect(focusedMarkerShown('L08', { status: 'error', message: 'x' }, none)).toBe(true)
    expect(focusedMarkerShown('L08', { status: 'loading' }, none)).toBe(false)
  })
  it('is false with no station focused', () => {
    expect(focusedMarkerShown(null, ready, none)).toBe(false)
  })
})
