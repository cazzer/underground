import { afterEach, describe, expect, it, vi } from 'vitest'
import { coveredStationIds, drawnInteriors, viewInteriorIds, viewStreetInterior, type IndexLoad } from './interiorLoad'

const index: IndexLoad = {
  status: 'ready',
  index: {
    stations: {
      '635': { provenance: 'authored' },
      L03: { provenance: 'authored', file: '635' },
      R20: { provenance: 'authored', file: '635' },
      L08: { provenance: 'authored' },
      L10: { provenance: 'generated' },
      A02: { provenance: 'generated' },
      A03: { provenance: 'generated' },
    },
  },
}

describe('viewInteriorIds', () => {
  it('keeps view order and skips stations the index lacks', () => {
    expect(viewInteriorIds(['L10', 'X99', 'L08'], null, index)).toEqual(['L10', 'L08'])
  })

  it('drops the focused file, a complex member focused included', () => {
    expect(viewInteriorIds(['R20', '635', 'L08'], 'R20', index)).toEqual(['L08'])
    expect(viewInteriorIds(['L08', 'L10'], 'L08', index)).toEqual(['L10'])
  })

  it('takes a file two view ids share once', () => {
    expect(viewInteriorIds(['L03', 'R20', 'L08'], null, index)).toEqual(['635', 'L08'])
  })

  it('leaves room for the focused file, loaded or not, within the cap', () => {
    const view = ['L08', 'L10', 'A02', 'A03']
    expect(viewInteriorIds(view, null, index)).toEqual(['L08', 'L10', 'A02'])
    // The focused file's slot is counted whatever its load says: only the index is read.
    expect(viewInteriorIds(['L08', 'L10', 'A02', 'A03'], 'L08', index)).toEqual(['L10', 'A02'])
  })

  it('does not count a focused station that has no file', () => {
    expect(viewInteriorIds(['X99', 'L08', 'L10', 'A02', 'A03'], 'X99', index)).toEqual(['L08', 'L10', 'A02'])
  })

  it('passes over a skipped file without spending a slot, and takes a lower cap', () => {
    const view = ['L08', 'L10', 'A02', 'A03']
    expect(viewInteriorIds(view, null, index, 3, (f) => f === 'L10')).toEqual(['L08', 'A02', 'A03'])
    expect(viewInteriorIds(view, 'L08', index, 2)).toEqual(['L10'])
  })

  it('is empty until the index is ready, and the same empty array each time', () => {
    expect(viewInteriorIds(['L08'], null, { status: 'loading' })).toEqual([])
    expect(viewInteriorIds(['L08'], null, { status: 'error', message: 'x' })).toEqual([])
    expect(viewInteriorIds([], null, index)).toBe(viewInteriorIds(['X99'], null, index))
  })
})

describe('drawnInteriors', () => {
  const known = (id: string) => id !== 'GONE'
  const m = (stationId: string, memberStationIds?: string[]) => ({ stationId, memberStationIds })
  afterEach(() => vi.restoreAllMocks())

  it('puts the focused interior first and takes each file once', () => {
    const f = m('L08')
    expect(drawnInteriors(f, [m('L10'), m('L08'), m('A02')], known).map((x) => x.stationId)).toEqual(['L08', 'L10', 'A02'])
  })

  it('caps at three, focused included', () => {
    expect(drawnInteriors(m('L08'), [m('L10'), m('A02'), m('A03')], known)).toHaveLength(3)
    expect(drawnInteriors(null, [m('L10'), m('A02'), m('A03'), m('L08')], known).map((x) => x.stationId)).toEqual(['L10', 'A02', 'A03'])
  })

  it('leaves out a model covering a station the map lacks, with one warning per file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = m('Z01', ['Z01', 'GONE'])
    expect(drawnInteriors(null, [bad, m('L10')], known).map((x) => x.stationId)).toEqual(['L10'])
    expect(drawnInteriors(null, [bad], known)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('coveredStationIds', () => {
  it("lists every interior's stations once, a complex's members included", () => {
    expect(coveredStationIds([{ stationId: '635', memberStationIds: ['635', 'L03', 'R20'] }, { stationId: 'L08' }, { stationId: 'L08' }])).toEqual([
      '635',
      'L03',
      'R20',
      'L08',
    ])
    expect(coveredStationIds([])).toEqual([])
  })
})

describe('viewStreetInterior', () => {
  const m = (stationId: string, memberStationIds?: string[]) => ({ stationId, memberStationIds })
  const union = m('635', ['635', 'L03', 'R20'])

  it('takes the drawn interior covering the station: marks against it, whole streets', () => {
    expect(viewStreetInterior('L08', [m('L10'), m('L08')], ['L08'], index)).toEqual({ interior: m('L08'), pending: false, clipped: false })
  })

  it('takes a drawn complex interior for any of its members', () => {
    expect(viewStreetInterior('L03', [union], ['635'], index).interior).toBe(union)
  })

  it('waits on its marks while the index loads', () => {
    expect(viewStreetInterior('L08', [], [], { status: 'loading' })).toEqual({ interior: null, pending: true, clipped: false })
  })

  it('waits on its marks while its file is requested and not drawn', () => {
    expect(viewStreetInterior('L03', [], ['635'], index)).toEqual({ interior: null, pending: true, clipped: false })
  })

  it('draws every mark and whole streets for a listed file not requested (past the cap, or failed lately)', () => {
    expect(viewStreetInterior('A02', [], ['L10'], index)).toEqual({ interior: null, pending: false, clipped: false })
  })

  it('clips the streets of a station with no interior file', () => {
    expect(viewStreetInterior('G22', [], [], index)).toEqual({ interior: null, pending: false, clipped: true })
  })
})
