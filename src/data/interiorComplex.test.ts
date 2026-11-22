import { describe, expect, it } from 'vitest'
import type { InteriorModel } from '../scene/interiorModel'
import { createInteriorCache } from './interiorCache'
import {
  deriveInteriorLoad, interiorCovers, interiorIdOf, interiorStationIds, NO_SIBLINGS, siblingIdsOf, type IndexLoad,
} from './interiorLoad'

const complex = { stationId: 'T01', memberStationIds: ['T01', 'U01', 'V01'] } as unknown as InteriorModel
const alone = { stationId: 'L08' } as InteriorModel
const index: IndexLoad = {
  status: 'ready',
  index: {
    stations: {
      L08: { provenance: 'authored' },
      T01: { provenance: 'authored' },
      U01: { provenance: 'authored', file: 'T01' },
      V01: { provenance: 'authored', file: 'T01' },
    },
  },
}

describe('interiorCovers', () => {
  it('matches the station of a single-station interior', () => {
    expect(interiorCovers(alone, 'L08')).toBe(true)
    expect(interiorCovers(alone, 'T01')).toBe(false)
  })
  it('matches every member of a complex and nothing else', () => {
    expect(['T01', 'U01', 'V01'].map((id) => interiorCovers(complex, id))).toEqual([true, true, true])
    expect(interiorCovers(complex, 'L08')).toBe(false)
  })
  it('is false for no interior or no station', () => {
    expect(interiorCovers(null, 'L08')).toBe(false)
    expect(interiorCovers(alone, null)).toBe(false)
  })
  it('interiorStationIds lists the members, else the station alone', () => {
    expect(interiorStationIds(complex)).toEqual(['T01', 'U01', 'V01'])
    expect(interiorStationIds(alone)).toEqual(['L08'])
  })
})

describe('interiorIdOf for a complex', () => {
  it('maps every member to the complex file', () => {
    expect(['T01', 'U01', 'V01', 'L08'].map((id) => interiorIdOf(id, index))).toEqual(['T01', 'T01', 'T01', 'L08'])
  })
})

describe('siblingIdsOf', () => {
  it('lists the other members, from any member', () => {
    expect(siblingIdsOf('T01', index)).toEqual(['U01', 'V01'])
    expect(siblingIdsOf('U01', index)).toEqual(['T01', 'V01'])
  })
  it('is the shared empty list for a lone station, an unlisted one, or an index that is not ready', () => {
    expect(siblingIdsOf('L08', index)).toBe(NO_SIBLINGS)
    expect(siblingIdsOf('X99', index)).toBe(NO_SIBLINGS)
    expect(siblingIdsOf(null, index)).toBe(NO_SIBLINGS)
    expect(siblingIdsOf('T01', { status: 'loading' })).toBe(NO_SIBLINGS)
  })
})

describe('deriveInteriorLoad for a complex', () => {
  const peek = (id: string) => (id === 'T01' ? complex : undefined)
  it('is ready for every member from the one cached file', () => {
    for (const id of ['T01', 'U01', 'V01']) expect(deriveInteriorLoad(id, index, peek, null)).toEqual({ status: 'ready', model: complex })
  })
  it('is loading for a member until the file settles', () => {
    expect(deriveInteriorLoad('U01', index, () => undefined, null)).toEqual({ status: 'loading' })
  })
  it('is an error when the file does not cover the station the index sent to it', () => {
    const stale = deriveInteriorLoad('V01', index, () => ({ stationId: 'T01', memberStationIds: ['T01', 'U01'] } as unknown as InteriorModel), null)
    expect(stale).toEqual({ status: 'error', message: 'stations/T01.json does not cover V01' })
  })
})

describe('the interior cache for a complex', () => {
  it('loads the file once whichever member is focused', async () => {
    const loads: string[] = []
    const cache = createInteriorCache((id) => {
      loads.push(id)
      return Promise.resolve(complex)
    })
    for (const member of ['T01', 'U01', 'V01', 'U01']) await cache.get(interiorIdOf(member, index)!)
    expect(loads).toEqual(['T01'])
  })
})
