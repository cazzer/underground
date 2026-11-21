import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { buildStationIndex } from './stationIndex.ts'

function interior(stationId: string, generated = false): StationInterior {
  return {
    stationId,
    name: stationId,
    anchor: { lat: 40.7, lon: -74 },
    license: 'ODbL-1.0',
    attribution: [],
    ...(generated ? { generated: { archetype: 'deep' as const, confidence: 0.9 } } : {}),
    levels: [],
    platforms: [],
    slabs: [],
    connectors: [],
    entrances: [],
    fareLines: [],
  }
}

describe('buildStationIndex', () => {
  it('sorts by id and marks provenance by the presence of `generated`', () => {
    const index = buildStationIndex([interior('L08'), interior('A01', true), interior('B02')])
    expect(Object.keys(index.stations)).toEqual(['A01', 'B02', 'L08'])
    expect(index.stations).toEqual({
      A01: { provenance: 'generated' },
      B02: { provenance: 'authored' },
      L08: { provenance: 'authored' },
    })
  })

  it('is empty for no interiors', () => {
    expect(buildStationIndex([])).toEqual({ stations: {} })
  })

  it('throws on a duplicate station id', () => {
    expect(() => buildStationIndex([interior('L08'), interior('L08', true)])).toThrow(/Duplicate interior for station L08/)
  })

  it('throws on the id "index", which would collide with index.json', () => {
    expect(() => buildStationIndex([interior('index')])).toThrow(/"index"/)
  })
})
