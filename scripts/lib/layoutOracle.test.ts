import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogStation } from './catalogTypes.ts'
import { parseOracle, splitOracle } from './layoutOracle.ts'

const sample = () => ({
  about: 'a',
  sourceLicense: 'CC BY-SA 4.0',
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
    const oldKey = { ...sample(), license: 'CC BY-SA 4.0', sourceLicense: undefined }
    expect(() => parseOracle(oldKey)).toThrow(/oracle.sourceLicense/)
  })

  it('reads the optional held-out fields and rejects a wrong type', () => {
    const o = sample()
    Object.assign(o.stations[0]!, { multiLevel: false, complex: true, tracksInService: 2, deep: true, note: 'n', components: [{ line: 'L', platformType: 'side', platforms: 2, tracks: 2 }] })
    expect(parseOracle(o).stations[0]).toMatchObject({ complex: true, tracksInService: 2, components: [{ line: 'L', tracks: 2 }] })
    const bad = sample()
    Object.assign(bad.stations[0]!, { complex: 'yes' })
    expect(() => parseOracle(bad)).toThrow(/complex: expected a boolean/)
  })
})

describe('splitOracle', () => {
  it('moves complex and multi-level stations to the declined list', () => {
    const o = sample()
    o.stations.push({ stationId: 'X02', name: 'X2', platformType: 'side', platforms: 2, tracks: 2, mezzanine: null, article: 'a', revision: 1, complex: true } as never, { stationId: 'X03', name: 'X3', platformType: 'side', platforms: 2, tracks: 2, mezzanine: null, article: 'a', revision: 1, multiLevel: true } as never)
    const { judged, declined } = splitOracle(parseOracle(o))
    expect(judged.map((s) => s.stationId)).toEqual(['X01'])
    expect(declined.map((d) => `${d.stationId}:${d.reason}`)).toEqual(['Y01:complex', 'X02:complex', 'X03:multi-level'])
  })
})

describe('committed oracle files', () => {
  const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'))
  const catalog = (read('data/stations/catalog/stations.json') as { rows: CatalogStation[] }).rows
  const tuning = parseOracle(read('data/stations/layout-oracle.json'))
  const holdout = parseOracle(read('data/stations/layout-holdout.json'))

  it('state their provenance honestly', () => {
    expect(tuning.about).toBe('Facts agent-checked against English Wikipedia (CC BY-SA 4.0); no text copied; not shipped.')
    expect(tuning.verifiedBy).toMatch(/agent/)
    expect(tuning.mezzanineRule).toMatch(/station house under an elevated line/)
    expect(holdout.verifiedBy).toMatch(/agent/)
    expect(holdout.about).toMatch(/held out from tuning/)
  })

  it('name catalog stations with the same name, and an article with a revision', () => {
    for (const o of [tuning, holdout]) {
      for (const s of [...o.stations, ...o.declined]) {
        const c = catalog.find((r) => r.gtfsStopId === s.stationId)
        expect(c, `${s.stationId} is in the catalog`).toBeDefined()
        expect(c!.name, `${s.stationId} name`).toBe(s.name)
        expect(s.article.length).toBeGreaterThan(3)
      }
    }
  })

  it('keep the held-out stations out of the tuning oracle', () => {
    const tuned = new Set([...tuning.stations, ...tuning.declined].map((s) => s.stationId))
    expect(holdout.stations.filter((s) => tuned.has(s.stationId)).map((s) => s.stationId)).toEqual([])
  })

  it('are big enough to mean something', () => {
    expect(tuning.stations.length).toBeGreaterThanOrEqual(35)
    expect(tuning.declined.length).toBeGreaterThanOrEqual(5)
    expect(holdout.stations.length).toBe(30)
  })
})
