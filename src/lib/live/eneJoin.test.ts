import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { StationInterior } from '../../data/stationSchema'
import { ENE_MAX_AGE_S, eneFresh, eneNowS, joinStationOutages, closedForRouting, type EneInput } from './eneJoin'

const l08 = JSON.parse(readFileSync(new URL('../../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior

const unionSq = JSON.parse(readFileSync(new URL('../../../public/data/stations/635.json', import.meta.url), 'utf8')) as StationInterior

const NOW = 2_000_000
const outage = (code: string, returnAt: number | null = NOW + 3600): EneOutage => ({ code, reason: null, since: NOW - 100, returnAt })
function feed(codes: EneOutage[], generatedAt = NOW, over: Partial<EneInput> = {}): EneInput {
  const snapshot: EneSnapshot = { version: 1, generatedAt, dropped: 0, outages: codes }
  return { configured: true, snapshot, byCode: new Map(codes.map((o) => [o.code, o])), failures: 0, schemaMismatch: false, ...over }
}
const noData = (over: Partial<EneInput> = {}): EneInput => ({ configured: true, snapshot: null, byCode: null, failures: 0, schemaMismatch: false, ...over })

describe('joinStationOutages', () => {
  it('names an outaged elevator with its levels, street end first, and feeds the drawing and routing', () => {
    const j = joinStationOutages(l08, feed([outage('EL358')]), NOW)
    expect(j.panel).toEqual({ kind: 'out', outages: [{ id: 'EL358', kind: 'elevator', levels: 'Mezzanine to platform', returnAt: NOW + 3600 }] })
    expect(j.outIds).toEqual(['EL358'])
    expect(j.known).toBe(true)
    expect(closedForRouting(j)).toEqual(new Set(['EL358']))
  })

  it('reads the street to mezzanine elevator the same way round', () => {
    const j = joinStationOutages(l08, feed([outage('EL359')]), NOW)
    expect(j.panel).toMatchObject({ outages: [{ id: 'EL359', levels: 'Street to mezzanine' }] })
  })

  describe('escalator direction', () => {
    // EL359 runs between the mezzanine (lower) and the street (upper).
    const base = l08.connectors.find((c) => c.id === 'EL359')!
    const withEscalators = (travels: Record<string, 'up' | 'down' | undefined>): StationInterior => ({
      ...l08,
      connectors: [
        ...l08.connectors,
        ...Object.entries(travels).map(([id, travel]) => ({ ...base, id, kind: 'escalator' as const, travel })),
      ],
    })
    const levelsOf = (interior: StationInterior, id: string): string | undefined => {
      const j = joinStationOutages(interior, feed([outage(id)]), NOW)
      return j.panel.kind === 'out' ? j.panel.outages[0]?.levels : undefined
    }

    it('names an up escalator from its lower level', () => {
      expect(levelsOf(withEscalators({ ES1: 'up' }), 'ES1')).toBe('Mezzanine up to street')
    })

    it('names a down escalator from its upper level', () => {
      expect(levelsOf(withEscalators({ ES1: 'down' }), 'ES1')).toBe('Street down to mezzanine')
    })

    it('reads two opposite escalators between the same levels differently', () => {
      const i = withEscalators({ ES257X: 'up', ES258X: 'down' })
      expect(levelsOf(i, 'ES257X')).not.toBe(levelsOf(i, 'ES258X'))
    })

    it("reads Union Sq's ES257X and ES258X as opposite directions on the real data", () => {
      const j = joinStationOutages(unionSq, feed([outage('ES257X'), outage('ES258X')]), NOW)
      const texts = j.panel.kind === 'out' ? Object.fromEntries(j.panel.outages.map((o) => [o.id, o.levels])) : {}
      expect(texts).toEqual({ ES257X: 'Mezzanine up to street', ES258X: 'Street down to mezzanine' })
    })

    it("keeps a proper level name's capital: Union Sq's ES219 runs up from the Canarsie platform", () => {
      const j = joinStationOutages(unionSq, feed([outage('ES219')]), NOW)
      expect(j.panel).toMatchObject({ outages: [{ id: 'ES219', levels: 'Canarsie platform up to mezzanine' }] })
    })

    // EL358 runs between the mezzanine (upper) and the platform (lower); name that platform like Union Sq's.
    const named: StationInterior = {
      ...l08,
      levels: l08.levels.map((l) => (l.id === 'platform' ? { ...l, name: 'Canarsie platform' } : l)),
      connectors: [
        ...l08.connectors,
        { ...l08.connectors.find((c) => c.id === 'EL358')!, id: 'ES1', kind: 'escalator', travel: 'down' },
      ],
    }

    it('keeps a proper name on a down escalator and an elevator, and lowercases a generic one', () => {
      expect(levelsOf(named, 'ES1')).toBe('Mezzanine down to Canarsie platform')
      expect(levelsOf(named, 'EL358')).toBe('Mezzanine to Canarsie platform')
      expect(levelsOf(l08, 'EL358')).toBe('Mezzanine to platform')
    })

    it('keeps the street-first wording for an escalator with no travel', () => {
      expect(levelsOf(withEscalators({ ES1: undefined }), 'ES1')).toBe('Street to mezzanine')
    })

    it('keeps elevators as they were, whatever travel says', () => {
      const i: StationInterior = { ...l08, connectors: l08.connectors.map((c) => (c.id === 'EL359' ? { ...c, travel: 'up' as const } : c)) }
      expect(levelsOf(i, 'EL359')).toBe('Street to mezzanine')
    })
  })

  it('lists several, sorted, and ignores codes the interior does not have', () => {
    const j = joinStationOutages(l08, feed([outage('EL359'), outage('EL358'), outage('EL999'), outage('ES1')]), NOW)
    expect(j.outIds).toEqual(['EL358', 'EL359'])
    expect(closedForRouting(j)).toEqual(new Set(['EL358', 'EL359']))
  })

  it('puts elevators before escalators, then by id', () => {
    const ES: StationInterior = {
      ...l08,
      connectors: [
        ...l08.connectors,
        { ...l08.connectors.find((c) => c.id === 'EL358')!, id: 'ES001', kind: 'escalator' },
        { ...l08.connectors.find((c) => c.id === 'EL358')!, id: 'ES000', kind: 'escalator' },
      ],
    }
    const j = joinStationOutages(ES, feed([outage('ES001'), outage('EL359'), outage('ES000'), outage('EL358')]), NOW)
    expect(j.panel.kind === 'out' && j.panel.outages.map((o) => o.id)).toEqual(['EL358', 'EL359', 'ES000', 'ES001'])
  })

  it('is none with fresh data and nothing of this interior out', () => {
    expect(joinStationOutages(l08, feed([outage('EL999')]), NOW).panel).toEqual({ kind: 'none' })
    expect(joinStationOutages(l08, feed([]), NOW).outIds).toEqual([])
  })

  it('keeps an overdue machine out: the MTA has not said it is back', () => {
    const j = joinStationOutages(l08, feed([outage('EL358', NOW - 60)]), NOW)
    expect(closedForRouting(j)?.has('EL358')).toBe(true)
    expect(j.panel).toMatchObject({ kind: 'out', outages: [{ returnAt: NOW - 60 }] })
  })

  it('trusts a snapshot of exactly ENE_MAX_AGE_S and not one second older', () => {
    const at = (age: number) => joinStationOutages(l08, feed([outage('EL358')], NOW - age), NOW)
    expect(at(ENE_MAX_AGE_S).known).toBe(true)
    expect(at(ENE_MAX_AGE_S).outIds).toEqual(['EL358'])
    const stale = at(ENE_MAX_AGE_S + 1)
    expect(stale.panel).toEqual({ kind: 'unknown', kinds: 'elevator' })
    expect(stale.known).toBe(false)
    // Unknown, not "all working": routing gets no set at all.
    expect(closedForRouting(stale)).toBeNull()
    expect(stale.outIds).toEqual([])
  })

  it('shows nothing while connecting (no snapshot, under two failures), unknown after two, and when the version mismatches', () => {
    expect(joinStationOutages(l08, noData(), NOW).panel).toEqual({ kind: 'none' })
    expect(joinStationOutages(l08, noData({ failures: 1 }), NOW).panel).toEqual({ kind: 'none' })
    expect(joinStationOutages(l08, noData({ failures: 2 }), NOW).panel).toEqual({ kind: 'unknown', kinds: 'elevator' })
    expect(joinStationOutages(l08, feed([outage('EL358')], NOW, { schemaMismatch: true }), NOW).panel).toMatchObject({ kind: 'unknown' })
  })

  it('names escalators too when the interior has both kinds', () => {
    const both: StationInterior = { ...l08, connectors: [...l08.connectors, { ...l08.connectors[0]!, id: 'ES1', kind: 'escalator' }] }
    expect(joinStationOutages(both, noData({ failures: 2 }), NOW).panel).toEqual({ kind: 'unknown', kinds: 'both' })
  })

  it('is none when not configured, with no interior, or when the interior has no machines, even without data', () => {
    expect(joinStationOutages(l08, { ...noData(), configured: false }, NOW)).toEqual({ panel: { kind: 'none' }, outIds: [], known: false, closed: null })
    expect(joinStationOutages(null, feed([outage('EL358')]), NOW).panel).toEqual({ kind: 'none' })
    const bare: StationInterior = { ...l08, connectors: l08.connectors.filter((c) => c.kind !== 'elevator' && c.kind !== 'escalator') }
    expect(joinStationOutages(bare, noData({ failures: 5 }), NOW).panel).toEqual({ kind: 'none' })
    expect(joinStationOutages(bare, feed([outage('EL358')]), NOW).outIds).toEqual([])
    // Not known either: an interior that is still loading must not read as a view of fresh data.
    expect(joinStationOutages(null, feed([outage('EL358')]), NOW).known).toBe(false)
    expect(joinStationOutages(bare, feed([]), NOW).known).toBe(false)
    // A machine-free interior has nothing to close, so routing may go ahead; no interior says nothing.
    expect(closedForRouting(joinStationOutages(bare, noData({ failures: 5 }), NOW))).toEqual(new Set())
    expect(closedForRouting(joinStationOutages(null, feed([]), NOW))).toBeNull()
  })
})

describe('eneNowS and eneFresh', () => {
  it('prefers the /rt live clock to the device clock', () => {
    expect(eneNowS(1000, 5000, 9_999_000)).toBe(1005)
    expect(eneNowS(null, 5000, 9_999_000)).toBe(9_999)
  })

  it('is fresh up to ENE_MAX_AGE_S', () => {
    const s = feed([]).snapshot
    expect(eneFresh(s, NOW + ENE_MAX_AGE_S)).toBe(true)
    expect(eneFresh(s, NOW + ENE_MAX_AGE_S + 1)).toBe(false)
    expect(eneFresh(null, NOW)).toBe(false)
  })
})
