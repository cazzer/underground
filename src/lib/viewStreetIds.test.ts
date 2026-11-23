import { describe, expect, it } from 'vitest'
import { MASK_N } from './basemap/streetMask'
import { MAX_VIEW_STATIONS, MAX_VIEW_STREETS, viewStreetIds } from './viewStations'

describe('viewStreetIds', () => {
  it('leaves the focused station out and keeps room for it', () => {
    expect(viewStreetIds(['L08', 'L10', 'A02', 'A03'], 'L08')).toEqual(['L10', 'A02', 'A03'])
    expect(viewStreetIds(['L08', 'L10', 'A02', 'A03', 'A05'], 'L08')).toHaveLength(MAX_VIEW_STREETS - 1)
  })

  it('takes four with none focused, in view order, each once', () => {
    expect(viewStreetIds(['A', 'B', 'A', 'C', 'D', 'E'], null)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('counts the focused station even when the view lacks it', () => {
    expect(viewStreetIds(['A', 'B', 'C', 'D'], 'Z')).toEqual(['A', 'B', 'C'])
  })

  it('returns one frozen empty list when nothing is in view', () => {
    const a = viewStreetIds([], null)
    expect(a).toEqual([])
    expect(viewStreetIds(['L08'], 'L08')).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('never draws more layers than the street mask has slots, nor than the view chooses', () => {
    expect(MAX_VIEW_STREETS).toBeLessThanOrEqual(MASK_N)
    expect(MAX_VIEW_STREETS).toBeLessThanOrEqual(MAX_VIEW_STATIONS)
  })
})
