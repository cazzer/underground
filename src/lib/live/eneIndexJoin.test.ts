import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EquipmentIndexFile } from '../../data/equipmentSchema'
import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { StationInterior } from '../../data/stationSchema'
import { joinStationOutages, type EneInput, type OutageJoin } from './eneJoin'
import { joinPanelOutages, stationEquipment, type StationEquipment } from './eneIndexJoin'
import { outagePanelView } from './eneText'
import { outageAnnouncement, outageSeen } from './outageAnnounce'

const l08 = JSON.parse(readFileSync(new URL('../../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior

const NOW = 2_000_000
const outage = (code: string, returnAt: number | null = NOW + 3600): EneOutage => ({ code, reason: null, since: NOW - 100, returnAt })
function feed(codes: EneOutage[], generatedAt = NOW, over: Partial<EneInput> = {}): EneInput {
  const snapshot: EneSnapshot = { version: 1, generatedAt, dropped: 0, outages: codes }
  return { configured: true, snapshot, byCode: new Map(codes.map((o) => [o.code, o])), failures: 0, schemaMismatch: false, ...over }
}
const noData = (over: Partial<EneInput> = {}): EneInput => ({ configured: true, snapshot: null, byCode: null, failures: 0, schemaMismatch: false, ...over })

/** L08's own machines are EL358 and EL359; EL900 (an elevator) and ES901 (an escalator) are only in the index. */
const index: EquipmentIndexFile = {
  format: 1,
  attribution: 'MTA',
  rowsUpdatedAt: '2026-01-01T00:00:00.000Z',
  machines: {
    EL358: { kind: 'elevator', serving: 'Catalog text for an interior machine.' },
    EL359: { kind: 'elevator', serving: null },
    EL900: { kind: 'elevator', serving: 'Mezzanine to Manhattan-bound platform.' },
    ES901: { kind: 'escalator', serving: null },
    EL950: { kind: 'elevator', serving: 'Street to mezzanine.' },
  },
  stations: { L08: ['EL358', 'EL359', 'EL900', 'ES901'], R30: ['EL900', 'ES901'], X01: ['EL950'] },
}
const ready = (stationId: string | null): StationEquipment => stationEquipment({ status: 'ready', index }, stationId)

/** The base join the app computes: the interior's (null: no interior). */
const base = (interior: StationInterior | null, ene: EneInput): OutageJoin => joinStationOutages(interior, ene, NOW)
const join = (interior: StationInterior | null, equipment: StationEquipment, ene: EneInput, settled = true): OutageJoin =>
  joinPanelOutages(base(interior, ene), interior, settled, equipment, ene, NOW)

describe('stationEquipment', () => {
  it('is unavailable until the index is ready (idle, or a failed load), loading while it loads', () => {
    expect(stationEquipment({ status: 'idle' }, 'R30')).toEqual({ status: 'unavailable' })
    expect(stationEquipment({ status: 'error', message: 'x' }, 'R30')).toEqual({ status: 'unavailable' })
    expect(stationEquipment({ status: 'loading' }, 'R30')).toEqual({ status: 'loading' })
    expect(ready(null)).toEqual({ status: 'unavailable' })
  })

  it('lists the station\'s machines with their kind and text; an unlisted station has none', () => {
    expect(ready('R30')).toEqual({
      status: 'ready',
      machines: [
        { id: 'EL900', kind: 'elevator', serving: 'Mezzanine to Manhattan-bound platform.' },
        { id: 'ES901', kind: 'escalator', serving: null },
      ],
    })
    expect(ready('Z99')).toEqual({ status: 'ready', machines: [] })
    expect(ready('toString')).toEqual({ status: 'ready', machines: [] })
  })
})

describe('joinPanelOutages', () => {
  it('names an index-only machine at a station with no interior: the inventory text, catalog source, known', () => {
    const j = join(null, ready('R30'), feed([outage('EL900')]))
    expect(j.panel).toEqual({
      kind: 'out',
      outages: [{ id: 'EL900', kind: 'elevator', levels: 'Mezzanine to Manhattan-bound platform.', source: 'catalog', returnAt: NOW + 3600 }],
    })
    expect(j.known).toBe(true)
    // Panel only: nothing is drawn or routed from an index-only machine.
    expect(j.outIds).toEqual([])
    expect(j.closed).toBeNull()
  })

  it('says none, known, when no index-only machine is out', () => {
    const j = join(null, ready('R30'), feed([outage('EL123')]))
    expect(j.panel).toEqual({ kind: 'none' })
    expect(j.known).toBe(true)
  })

  it('has no text line for an inventory row without one', () => {
    const j = join(null, ready('R30'), feed([outage('ES901')]))
    expect(j.panel).toMatchObject({ outages: [{ id: 'ES901', levels: null, source: 'catalog' }] })
    const row = outagePanelView(j, NOW).body
    expect(row).toMatchObject({ kind: 'out', rows: [{ levels: null, wraps: true }] })
  })

  it('lets the interior win a machine both know: its level text, outIds and closed unchanged', () => {
    const ene = feed([outage('EL358'), outage('EL900')])
    const interiorOnly = base(l08, ene)
    const j = join(l08, ready('L08'), ene)
    expect(j.panel).toMatchObject({
      kind: 'out',
      outages: [
        { id: 'EL358', levels: 'Mezzanine to platform', source: 'interior' },
        { id: 'EL900', source: 'catalog' },
      ],
    })
    expect(j.outIds).toEqual(['EL358'])
    expect(j.closed).toEqual(interiorOnly.closed)
    expect(j.known).toBe(true)
  })

  it('adds a complex mate\'s machine, and sorts elevators first then by code across both sources', () => {
    const j = join(l08, ready('L08'), feed([outage('ES901'), outage('EL359'), outage('EL900')]))
    expect(j.panel.kind === 'out' && j.panel.outages.map((o) => `${o.id}:${o.source}`)).toEqual(['EL359:interior', 'EL900:catalog', 'ES901:catalog'])
  })

  it('is known and none for an interior whose machines are all in service and index-only ones too', () => {
    const j = join(l08, ready('L08'), feed([]))
    expect(j.panel).toEqual({ kind: 'none' })
    expect(j.known).toBe(true)
  })

  describe('before the sources settle', () => {
    it('is not known while the index loads, whatever the feed says', () => {
      const ene = feed([outage('EL358')])
      const j = join(l08, { status: 'loading' }, ene)
      expect(j.known).toBe(false)
      expect(j.panel).toEqual(base(l08, ene).panel)
      expect(j.outIds).toEqual(['EL358'])
    })

    it('is not known while the interior load is unsettled', () => {
      expect(join(null, ready('R30'), feed([outage('EL900')]), false)).toMatchObject({ known: false, panel: { kind: 'none' } })
    })

    it('stays silent when the sources arrive later: loading to ready is no announcement', () => {
      const ene = feed([outage('EL900')])
      const early = outageSeen('R30', outagePanelView(join(null, { status: 'loading' }, ene), NOW))
      const late = outageSeen('R30', outagePanelView(join(null, ready('R30'), ene), NOW))
      expect(late.out.has('EL900')).toBe(true)
      expect(outageAnnouncement(early, late)).toBe('')
      // From then on a change is news.
      const later = outageSeen('R30', outagePanelView(join(null, ready('R30'), feed([outage('EL900'), outage('ES901')])), NOW))
      expect(outageAnnouncement(late, later)).toBe('Escalator ES901 is now out of service.')
    })
  })

  describe('with nothing to add', () => {
    it('returns the base join itself when the index is unavailable', () => {
      const ene = feed([outage('EL358')])
      const b = base(l08, ene)
      expect(joinPanelOutages(b, l08, true, { status: 'unavailable' }, ene, NOW)).toBe(b)
    })

    it('returns the base join itself when the station has no index-only machine', () => {
      const ene = feed([outage('EL358')])
      const b = base(null, ene)
      expect(joinPanelOutages(b, null, true, ready('Z99'), ene, NOW)).toBe(b)
      const bl = base(l08, ene)
      const only = stationEquipment({ status: 'ready', index: { ...index, stations: { L08: ['EL358', 'EL359'] } } }, 'L08')
      expect(joinPanelOutages(bl, l08, true, only, ene, NOW)).toBe(bl)
    })

    it('returns the base join itself when the outage feed is not configured', () => {
      const ene = { ...noData(), configured: false }
      const b = base(null, ene)
      expect(joinPanelOutages(b, null, true, ready('R30'), ene, NOW)).toBe(b)
    })

    it('says nothing while the first poll is connecting', () => {
      const b = base(null, noData())
      expect(joinPanelOutages(b, null, true, ready('R30'), noData(), NOW)).toBe(b)
      expect(joinPanelOutages(b, null, true, ready('R30'), noData({ failures: 1 }), NOW)).toBe(b)
    })
  })

  describe('without fresh outage data', () => {
    it('says status unavailable for the index-only machines\' kinds after two failed polls', () => {
      expect(join(null, ready('R30'), noData({ failures: 2 })).panel).toEqual({ kind: 'unknown', kinds: 'both' })
      expect(join(null, ready('R30'), noData({ failures: 2 })).known).toBe(false)
    })

    it('says it for a stale snapshot and for a schema mismatch', () => {
      expect(join(null, ready('R30'), feed([outage('EL900')], NOW - 481)).panel).toMatchObject({ kind: 'unknown' })
      expect(join(null, ready('R30'), feed([outage('EL900')], NOW, { schemaMismatch: true })).panel).toMatchObject({ kind: 'unknown' })
    })

    it('covers the union of the interior\'s and the index\'s kinds', () => {
      const elevatorsOnly = stationEquipment({ status: 'ready', index: { ...index, stations: { L08: ['EL358', 'EL900'] } } }, 'L08')
      expect(join(l08, elevatorsOnly, noData({ failures: 2 })).panel).toEqual({ kind: 'unknown', kinds: 'elevator' })
      expect(join(l08, ready('L08'), noData({ failures: 2 })).panel).toEqual({ kind: 'unknown', kinds: 'both' })
    })
  })
})
