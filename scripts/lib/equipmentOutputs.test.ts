/** The committed public/data/stations/equipment.json: fresh against the pinned catalog and stations.json, inside its own cap, and consistent. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EquipmentIndexFile } from '../../src/data/equipmentSchema.ts'
import type { StationsFile } from '../../src/data/schema.ts'
import { checkEquipmentCap, EQUIPMENT_GZIP_CAP_BYTES, renderedFile } from './budget.ts'
import type { CatalogEquipment, CatalogStation, SodaHeader } from './catalogTypes.ts'
import { buildEquipmentIndex } from './equipmentIndex.ts'
import { toStableJson } from './stableJson.ts'
import { EQUIPMENT_FILE } from './stationIndex.ts'

const text = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const catalog = <T>(name: string): SodaHeader & { rows: T[] } => JSON.parse(text(`../../data/stations/catalog/${name}.json`)) as SodaHeader & { rows: T[] }
const committedText = text(`../../public/data/stations/${EQUIPMENT_FILE}`)
const committed = JSON.parse(committedText) as EquipmentIndexFile
const stationsFile = JSON.parse(text('../../public/data/stations.json')) as StationsFile
const knownStations = new Set(stationsFile.stations.map((s) => s.id))
const equipment = catalog<CatalogEquipment>('equipment')

describe('stations/equipment.json', () => {
  it('is fresh: rebuilding from the pinned catalog and stations.json reproduces it byte for byte', () => {
    const { file } = buildEquipmentIndex(catalog<CatalogStation>('stations').rows, equipment.rows, equipment.rowsUpdatedAt, knownStations)
    expect(toStableJson(file, 2)).toBe(committedText)
  })

  it('fits its own gzip cap', () => {
    expect(checkEquipmentCap(renderedFile(EQUIPMENT_FILE, committedText))).toBeLessThanOrEqual(EQUIPMENT_GZIP_CAP_BYTES)
  })

  it('keys only stations stations.json has, and lists only machines it describes', () => {
    for (const [id, codes] of Object.entries(committed.stations)) {
      expect(knownStations.has(id), id).toBe(true)
      expect(codes.length, id).toBeGreaterThan(0)
      for (const code of codes) expect(Object.hasOwn(committed.machines, code), `${id} ${code}`).toBe(true)
    }
  })

  it('lists every machine at some station', () => {
    const listed = new Set(Object.values(committed.stations).flat())
    expect(Object.keys(committed.machines).filter((code) => !listed.has(code))).toEqual([])
  })
})
