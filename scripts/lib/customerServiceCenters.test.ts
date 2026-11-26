import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCustomerServiceCenters } from './customerServiceCenters.ts'

const good = {
  source: 'https://example.test/page',
  retrievedAt: '2026-11-26',
  about: 'a',
  centers: [{ gtfsStopId: '127', name: 'Times Sq-42 St', pageName: 'Times Sq-42 St', entrance: 'Enter at 42 St and 7 Av' }],
}
const withCenters = (centers: unknown[]): unknown => ({ ...good, centers })

describe('parseCustomerServiceCenters', () => {
  it('accepts a good file, with or without entrance and hours', () => {
    expect(parseCustomerServiceCenters(good).centers).toHaveLength(1)
    const c = parseCustomerServiceCenters(withCenters([{ gtfsStopId: 'S31', name: 'St George', pageName: 'St. George', hours: '5:30 a.m.-9 p.m.' }]))
    expect(c.centers[0]).toEqual({ gtfsStopId: 'S31', name: 'St George', pageName: 'St. George', hours: '5:30 a.m.-9 p.m.' })
  })

  it('rejects bad shapes', () => {
    expect(() => parseCustomerServiceCenters([])).toThrow(/must be an object/)
    expect(() => parseCustomerServiceCenters({ ...good, source: '' })).toThrow(/"source"/)
    expect(() => parseCustomerServiceCenters({ ...good, retrievedAt: 'yesterday' })).toThrow(/YYYY-MM-DD/)
    expect(() => parseCustomerServiceCenters({ ...good, centers: [] })).toThrow(/non-empty array/)
    expect(() => parseCustomerServiceCenters(withCenters(['127']))).toThrow(/must be an object/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...good.centers[0], name: '' }]))).toThrow(/"name"/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...good.centers[0], entrance: 3 }]))).toThrow(/"entrance"/)
    expect(() => parseCustomerServiceCenters(withCenters([{ ...good.centers[0], booth: true }]))).toThrow(/unknown key booth/)
  })

  it('rejects a duplicate stop id', () => {
    expect(() => parseCustomerServiceCenters(withCenters([good.centers[0], good.centers[0]]))).toThrow(/duplicate gtfsStopId 127/)
  })
})

describe('committed customer-service-centers.json', () => {
  const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'))
  const catalog = (read('data/stations/catalog/stations.json') as { rows: { gtfsStopId: string; name: string }[] }).rows
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

  it('is sorted by stop id and gives hours only where it is not 24/7', () => {
    const ids = file.centers.map((c) => c.gtfsStopId)
    expect(ids).toEqual([...ids].sort())
    expect(file.centers.filter((c) => c.hours !== undefined).map((c) => c.gtfsStopId)).toEqual(['S31'])
  })

  it('has every center the page lists', () => {
    expect(file.centers).toHaveLength(30)
  })
})
