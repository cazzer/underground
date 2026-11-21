import { describe, expect, it } from 'vitest'
import type { InteriorModel } from '../scene/interiorModel'
import { deriveInteriorLoad } from './interiorLoad'

const model = { stationId: 'L08' } as InteriorModel
const empty = () => undefined
const cached = (id: string) => (id === 'L08' ? model : undefined)

describe('deriveInteriorLoad', () => {
  it('is none without a station', () => {
    expect(deriveInteriorLoad(null, cached, null)).toEqual({ status: 'none' })
  })

  it('is ready from the cache, whatever the settled attempt says', () => {
    const error = { id: 'L08', load: { status: 'error' as const, message: 'HTTP 500' } }
    expect(deriveInteriorLoad('L08', cached, error)).toEqual({ status: 'ready', model })
  })

  it('is loading until an attempt for this station settles', () => {
    expect(deriveInteriorLoad('L08', empty, null)).toEqual({ status: 'loading' })
    const other = { id: 'L10', load: { status: 'error' as const, message: 'x' } }
    expect(deriveInteriorLoad('L08', empty, other)).toEqual({ status: 'loading' })
  })

  it("shows this station's settled error", () => {
    const error = { id: 'L08', load: { status: 'error' as const, message: 'HTTP 500' } }
    expect(deriveInteriorLoad('L08', empty, error)).toBe(error.load)
  })
})
