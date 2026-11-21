import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogStation } from './catalogTypes.ts'
import { parseOracle } from './layoutOracle.ts'

const sample = () => ({
  about: 'a',
  license: 'CC BY-SA 4.0',
  verifiedBy: 'agent',
  retrievedAt: '2026-11-21',
  declined: [{ stationId: 'Y01', name: 'Y', reason: 'complex', article: 'Y station', revision: 7 }],
  stations: [{ stationId: 'X01', name: 'X', platformType: 'island', platforms: 1, tracks: 2, mezzanine: true, article: 'X station', revision: 12345 }],
})

describe('parseOracle', () => {
  it('accepts a well-formed oracle', () => {
    expect(parseOracle(sample()).stations[0]).toMatchObject({ stationId: 'X01', platformType: 'island', tracks: 2 })
  })

  it('names the path of a bad field', () => {
    const bad = sample()
    ;(bad.stations[0] as Record<string, unknown>).platformType = 'both'
    expect(() => parseOracle(bad)).toThrow(/oracle.stations\[0\].platformType/)
    const noTracks = sample()
    ;(noTracks.stations[0] as Record<string, unknown>).tracks = 0
    expect(() => parseOracle(noTracks)).toThrow(/tracks: expected a positive integer/)
    const dup = sample()
    dup.stations.push({ ...dup.stations[0]! })
    expect(() => parseOracle(dup)).toThrow(/duplicate X01/)
    const badReason = sample()
    ;(badReason.declined[0] as Record<string, unknown>).reason = 'odd'
    expect(() => parseOracle(badReason)).toThrow(/oracle.declined\[0\].reason/)
  })
})

describe('committed layout-oracle.json', () => {
  const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'))
  const oracle = parseOracle(read('data/stations/layout-oracle.json'))
  const catalog = (read('data/stations/catalog/stations.json') as { rows: CatalogStation[] }).rows

  it('states its provenance honestly', () => {
    expect(oracle.about).toBe('Facts hand-checked against English Wikipedia (CC BY-SA 4.0); no text copied; not shipped.')
    expect(oracle.verifiedBy).toMatch(/agent/)
  })

  it('names catalog stations with the same name, and an article with a revision', () => {
    for (const s of oracle.stations) {
      const c = catalog.find((r) => r.gtfsStopId === s.stationId)
      expect(c, `${s.stationId} is in the catalog`).toBeDefined()
      expect(c!.name, `${s.stationId} name`).toBe(s.name)
      expect(s.article.length).toBeGreaterThan(3)
    }
  })

  it('lists declined stations that exist in the catalog', () => {
    for (const d of oracle.declined) expect(catalog.find((r) => r.gtfsStopId === d.stationId)?.name, d.stationId).toBe(d.name)
    expect(oracle.declined.length).toBeGreaterThanOrEqual(5)
  })

  it('is big enough to mean something', () => {
    expect(oracle.stations.length).toBeGreaterThanOrEqual(35)
  })
})
