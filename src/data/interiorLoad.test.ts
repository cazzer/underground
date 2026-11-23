import { describe, expect, it } from 'vitest'
import type { InteriorModel } from '../scene/interiorModel'
import { authoredInteriorIds, deriveInteriorLoad, focusedMarkerShown, interiorIdOf, layoutOf, modelsToLoad, type IndexLoad, type InteriorLoad } from './interiorLoad'

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

describe('layoutOf', () => {
  const index: IndexLoad = {
    status: 'ready',
    index: { stations: { '635': { provenance: 'authored' }, L03: { provenance: 'authored', file: '635' }, A02: { provenance: 'generated' } } },
  }
  it("is the provenance of the station's interior file, a complex member through its file", () => {
    expect(layoutOf('635', index)).toBe('authored')
    expect(layoutOf('L03', index)).toBe('authored')
    expect(layoutOf('A02', index)).toBe('generated')
  })
  it('is none for a station the ready index does not list', () => {
    expect(layoutOf('127', index)).toBe('none')
    expect(layoutOf('toString', index)).toBe('none')
  })
  it('is null while the index is loading or failed', () => {
    expect(layoutOf('635', { status: 'loading' })).toBeNull()
    expect(layoutOf('635', { status: 'error', message: 'x' })).toBeNull()
  })
})

describe('authoredInteriorIds', () => {
  it('lists each hand-authored interior file once, a complex by its file id, and no generated one', () => {
    const index: IndexLoad = {
      status: 'ready',
      index: {
        stations: {
          L08: { provenance: 'authored' },
          R20: { provenance: 'authored', file: '635' },
          '635': { provenance: 'authored' },
          L03: { provenance: 'authored', file: '635' },
          A01: { provenance: 'generated' },
        },
      },
    }
    expect(authoredInteriorIds(index)).toEqual(['635', 'L08'])
    expect(authoredInteriorIds({ status: 'loading' })).toEqual([])
  })
})

describe('modelsToLoad', () => {
  it('fetches the ids not loaded yet', () => {
    expect(modelsToLoad(['635', 'L08'], (id) => id === 'L08', 'L08')).toEqual({ fetch: ['635'], stale: false })
  })

  it('is stale when a load settled between the render and its effect, so the effect re-renders', () => {
    // Rendered with nothing loaded; 635 landed in the cache before the effect ran.
    expect(modelsToLoad(['635', 'L08'], (id) => id === '635', '')).toEqual({ fetch: ['L08'], stale: true })
    expect(modelsToLoad(['635'], () => true, '635')).toEqual({ fetch: [], stale: false })
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
