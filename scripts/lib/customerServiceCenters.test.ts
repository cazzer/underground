import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogStation } from './catalogTypes.ts'
import { parseCustomerServiceCenters } from './customerServiceCenters.ts'

const center = { gtfsStopId: '127', name: 'Times Sq-42 St', pageName: 'Times Sq-42 St', entrance: 'Enter at 42 St and 7 Av' }
const good = { source: 'https://example.test/page', retrievedAt: '2026-11-26', about: 'a', centers: [center] }
const withCenters = (centers: unknown[]): unknown => ({ ...good, centers })

describe('parseCustomerServiceCenters', () => {
  it('accepts a good file', () => {
    expect(parseCustomerServiceCenters(good).centers).toEqual([center])
  })

  it('rejects bad shapes', () => {
    expect(() => parseCustomerServiceCenters([])).toThrow(/expected an object/)
    expect(() => parseCustomerServiceCenters({ ...good, source: '' })).toThrow(/source: expected a non-empty string/)
    expect(() => parseCustomerServiceCenters({ ...good, extra: 1 })).toThrow(/unknown key "extra"/)
    expect(() => parseCustomerServiceCenters({ ...good, centers: [] })).toThrow(/at least one center/)
    expect(() => parseCustomerServiceCenters({ ...good, centers: {} })).toThrow(/expected an array/)
    expect(() => parseCustomerServiceCenters(withCenters(['127']))).toThrow(/expected an object/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...center, name: '' }]))).toThrow(/centers\[0\]\.name/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...center, entrance: undefined }]))).toThrow(/centers\[0\]\.entrance/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...center, hours: '9-5' }]))).toThrow(/unknown key "hours"/)
  })

  it('rejects a date that is not a real one', () => {
    for (const d of ['yesterday', '2026-13-01', '2026-02-30', '2026-1-1']) {
      expect(() => parseCustomerServiceCenters({ ...good, retrievedAt: d }), d).toThrow(/real YYYY-MM-DD date/)
    }
  })

  it('rejects a duplicate stop id', () => {
    expect(() => parseCustomerServiceCenters(withCenters([center, center]))).toThrow(/duplicate gtfsStopId 127/)
  })
})

describe('committed customer-service-centers.json', () => {
  const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'))
  const catalog = (read('data/stations/catalog/stations.json') as { rows: CatalogStation[] }).rows
  const file = parseCustomerServiceCenters(read('data/stations/customer-service-centers.json'))

  it('names the page it was copied from', () => {
    expect(file.source).toBe('https://www.mta.info/contact-us/customer-service-centers')
  })

  it('names catalog stations by id and catalog name', () => {
    for (const c of file.centers) {
      const row = catalog.find((r) => r.gtfsStopId === c.gtfsStopId)
      expect(row, `${c.gtfsStopId} is in the catalog`).toBeDefined()
      expect(row!.name, `${c.gtfsStopId} name`).toBe(c.name)
    }
  })

  it('lists each complex once', () => {
    const complexOf = (id: string): string => catalog.find((r) => r.gtfsStopId === id)!.complexId
    const ids = file.centers.map((c) => complexOf(c.gtfsStopId))
    expect(ids.filter((c, i) => ids.indexOf(c) !== i)).toEqual([])
  })

  it('is sorted by stop id', () => {
    const ids = file.centers.map((c) => c.gtfsStopId)
    expect(ids).toEqual([...ids].sort())
  })

  it('has every subway center the page lists', () => {
    expect(file.centers).toHaveLength(29)
  })
})
