import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationIndex } from '../../src/data/stationSchema.ts'
import type { CatalogStation } from './catalogTypes.ts'
import { DEEP_RISE_M, PINNED_DEEP, tallestRise } from './deepArchetype.ts'
import { equipmentFact } from './archetypeFixtures.ts'

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const catalog = (read('../../data/stations/catalog/stations.json') as { rows: CatalogStation[] }).rows
const index = read('../../public/data/stations/index.json') as StationIndex

describe('PINNED_DEEP', () => {
  it('names catalog stations by their catalog name, once each', () => {
    expect(new Set(PINNED_DEEP.map((d) => d.stationId)).size).toBe(PINNED_DEEP.length)
    for (const d of PINNED_DEEP) {
      const row = catalog.find((s) => s.gtfsStopId === d.stationId)
      expect(row, d.stationId).toBeDefined()
      expect(d.name.replace(/ \(.*\)$/, ''), d.stationId).toBe(row!.name)
    }
  })

  it('keeps every pinned station out of the committed interiors', () => {
    for (const d of PINNED_DEEP) expect(index.stations[d.stationId], d.stationId).toBeUndefined()
  })
})

describe('tallestRise', () => {
  it('takes the tallest parsable rise and skips the rest', () => {
    const machines = [equipmentFact('EL1', 'x to y', "12' - 0in"), equipmentFact('EL2', 'x to y', 'unknown'), equipmentFact('EL3', 'x to y', "61' - 0in"), equipmentFact('EL4', 'x to y')]
    const t = tallestRise(machines)
    expect(t?.code).toBe('EL3')
    expect(t!.m).toBeGreaterThan(DEEP_RISE_M)
    expect(tallestRise([equipmentFact('EL5', 'x to y')])).toBeNull()
  })
})
