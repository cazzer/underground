import { describe, expect, it } from 'vitest'
import type { CatalogEquipment, CatalogStation } from './catalogTypes.ts'
import { buildEquipmentIndex, cleanServing } from './equipmentIndex.ts'

const station = (gtfsStopId: string, stationId: string, complexId: string): CatalogStation => ({
  gtfsStopId,
  stationId,
  complexId,
  division: 'IND',
  line: 'x',
  name: gtfsStopId,
  borough: 'M',
  routes: [],
  structure: 'Subway',
  lat: 40.7,
  lon: -74,
  ada: 1,
  adaNorth: true,
  adaSouth: true,
  adaNotes: null,
  northLabel: 'N',
  southLabel: 'S',
})

const machine = (code: string, stationId: string | null, over: Partial<CatalogEquipment> = {}): CatalogEquipment => ({
  code,
  kind: code.startsWith('ES') ? 'escalator' : 'elevator',
  revenue: true,
  stationId,
  complexId: null,
  lat: null,
  lon: null,
  serving: `${code} serving`,
  rise: null,
  landings: null,
  direction: null,
  ada: null,
  streetAccess: null,
  mezzanine1Access: null,
  mezzanine2Access: null,
  platformAccess: null,
  ...over,
})

// A and B are two stations of complex C1; D is alone; E has no row in stations.json.
const STATIONS = [station('A01', '1', 'C1'), station('B01', '2', 'C1'), station('D01', '3', 'C3'), station('E01', '4', 'C4')]
const KNOWN = new Set(['A01', 'B01', 'D01'])
const build = (equipment: CatalogEquipment[], known: ReadonlySet<string> = KNOWN) => buildEquipmentIndex(STATIONS, equipment, '2026-01-01T00:00:00.000Z', known)

describe('cleanServing', () => {
  it('collapses whitespace, drops control and bidi characters, capitalises the first letter', () => {
    expect(cleanServing('  street\n to   mezzanine\t ')).toBe('Street to mezzanine')
    expect(cleanServing('Street\u202E to\u200B mezzanine\u0007')).toBe('Street to mezzanine')
  })

  it('removes U+FEFF and lone surrogates outright, not as a space', () => {
    expect(cleanServing('Street\uFEFFto mezzanine')).toBe('Streetto mezzanine')
    expect(cleanServing('Street\uD800 to mezzanine')).toBe('Street to mezzanine')
  })

  it('trims one trailing period so catalog rows punctuate like the panel\'s other lines', () => {
    expect(cleanServing('Street to platform.')).toBe('Street to platform')
    expect(cleanServing('street to platform. ')).toBe('Street to platform')
    expect(cleanServing('Street. Platform.')).toBe('Street. Platform')
    expect(cleanServing('.')).toBeNull()
  })

  it('is null for none, empty or only invisible characters, and never truncates', () => {
    expect(cleanServing(null)).toBeNull()
    expect(cleanServing('   ')).toBeNull()
    expect(cleanServing('\u200B\u0007')).toBeNull()
    expect(cleanServing('a'.repeat(500))).toHaveLength(500)
  })
})

describe('buildEquipmentIndex', () => {
  it('lists a complex machine under every member that stations.json has, and nothing for a station without machines', () => {
    const { file } = build([machine('EL1', '1'), machine('ES2', '4'), machine('EL3', '3')])
    expect(file.stations).toEqual({ A01: ['EL1'], B01: ['EL1'], D01: ['EL3'] })
    expect(file.machines.EL1).toEqual({ kind: 'elevator', serving: 'EL1 serving' })
  })

  it('reads the members from the station row, not the machine row\'s own complex id', () => {
    expect(build([machine('EL1', '2', { complexId: 'C3' })]).file.stations).toEqual({ A01: ['EL1'], B01: ['EL1'] })
  })

  it('drops members stations.json lacks, and logs a machine with none left', () => {
    const { file, log } = build([machine('EL1', '1'), machine('ES2', '4')], new Set(['B01']))
    expect(file.stations).toEqual({ B01: ['EL1'] })
    expect(Object.keys(file.machines)).toEqual(['EL1'])
    expect(log.join('\n')).toMatch(/ES2: no station of its complex is in stations.json/)
  })

  it('skips and logs non-revenue machines and machines with no station', () => {
    const { file, log } = build([machine('EL1', '1', { revenue: false }), machine('EL2', null), machine('EL3', '3')])
    expect(Object.keys(file.machines)).toEqual(['EL3'])
    expect(log).toEqual(['1 non-revenue machine(s) left out', '1 revenue machine(s) with no station left out: EL2'])
  })

  it('sorts the machines and every station list by code', () => {
    const { file } = build([machine('ES9', '1'), machine('EL2', '1'), machine('EL10', '3'), machine('EL1', '3')])
    expect(Object.keys(file.machines)).toEqual(['EL1', 'EL10', 'EL2', 'ES9'])
    expect(file.stations.A01).toEqual(['EL2', 'ES9'])
    expect(file.stations.D01).toEqual(['EL1', 'EL10'])
  })

  it('cleans the serving text, and keeps null as null', () => {
    const { file } = build([machine('EL1', '1', { serving: ' street  to platform ' }), machine('EL2', '1', { serving: null })])
    expect(file.machines.EL1!.serving).toBe('Street to platform')
    expect(file.machines.EL2!.serving).toBeNull()
  })

  it('skips and logs a code the Worker would not accept', () => {
    const { file, log } = build([machine('el1', '1'), machine('E', '1'), machine('EL3', '3')])
    expect(Object.keys(file.machines)).toEqual(['EL3'])
    expect(log).toHaveLength(2)
  })

  it('throws for a repeated code and for a station the catalog lacks', () => {
    expect(() => build([machine('EL1', '1'), machine('EL1', '3')])).toThrow(/EL1 appears twice/)
    // Even when the rows would be filtered out anyway.
    expect(() => build([machine('EL1', '1', { revenue: false }), machine('EL1', null)])).toThrow(/EL1 appears twice/)
    expect(() => build([machine('el1', '1'), machine('el1', '1')])).toThrow(/el1 appears twice/)
    expect(() => build([machine('EL1', '99')])).toThrow(/station 99 is not in the station catalog/)
  })

  it('carries the inventory time and no build time', () => {
    const { file } = build([machine('EL1', '1')])
    expect(file.rowsUpdatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(Object.keys(file)).toEqual(['format', 'attribution', 'rowsUpdatedAt', 'machines', 'stations'])
  })
})
