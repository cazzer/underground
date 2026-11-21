import { describe, expect, it } from 'vitest'
import type { ArchetypeParams, ArchetypeResult } from './archetype.ts'
import { declinedReport, distribution, judge, oracleReport, pathwaysReport } from './archetypeScore.ts'
import type { OracleStation } from './layoutOracle.ts'

const params = (over: Partial<ArchetypeParams>): ArchetypeParams =>
  ({ platformType: 'island', trackCount: 2, hasMezzanine: true, ...over }) as ArchetypeParams
const result = (archetype: ArchetypeResult['archetype'], confidence: number, p: Partial<ArchetypeParams> | null): ArchetypeResult => ({ archetype, confidence, reasons: [], params: p ? params(p) : null })
const oracle = (over: Partial<OracleStation> = {}): OracleStation => ({ stationId: 'X01', name: 'X', platformType: 'island', platforms: 1, tracks: 2, mezzanine: true, article: 'X', revision: 1, ...over })

describe('judge', () => {
  it('is correct when platform type and track count match, and flags a mezzanine miss without failing it', () => {
    expect(judge(oracle(), result('cut-cover-mezzanine', 0.9, {}))).toMatchObject({ correct: true, problems: [] })
    const m = judge(oracle({ mezzanine: false }), result('cut-cover-mezzanine', 0.9, {}))
    expect(m.correct).toBe(true)
    expect(m.problems).toEqual(['mezzanine true, article says false'])
  })

  it('names a wrong platform type and a wrong track count', () => {
    const o = judge(oracle(), result('shallow-per-direction', 0.9, { platformType: 'side', trackCount: 4 }))
    expect(o.correct).toBe(false)
    expect(o.problems).toEqual(['platform type side, article says island', '4 tracks, article says 2'])
  })

  it('has no answer without params', () => {
    expect(judge(oracle(), result('unknown', 0.2, null))).toMatchObject({ correct: false, problems: ['no params (unknown, 0.20)'] })
  })
})

describe('reports', () => {
  it('counts precision among stations at or above the bar', () => {
    const ok = judge(oracle({ stationId: 'A' }), result('cut-cover-mezzanine', 0.9, {}))
    const bad = judge(oracle({ stationId: 'B' }), result('cut-cover-mezzanine', 0.8, { platformType: 'side' }))
    const low = judge(oracle({ stationId: 'C' }), result('cut-cover-mezzanine', 0.4, { platformType: 'side' }))
    const text = oracleReport([ok, bad, low], 0.7).join('\n')
    expect(text).toMatch(/Precision at or above 0.7 .*: 50.0% \(1\/2\)/)
    expect(text).toMatch(/Track count accuracy: 100.0% \(3\/3\)/)
  })

  it('counts declined stations that stay below the bar', () => {
    const d = (id: string) => ({ stationId: id, name: id, reason: 'complex' as const, article: 'a', revision: 1 })
    const results = new Map([['A', result('unknown', 0.2, null)], ['B', result('cut-cover-mezzanine', 0.9, {})]])
    expect(declinedReport([d('A'), d('B')], results, 0.7).join('\n')).toMatch(/50.0% \(1\/2\) stay below 0.7[\s\S]*MISS B/)
  })

  it('lists the archetype distribution and coverage', () => {
    const all = [{ stationId: 'A', name: 'A', result: result('deep', 0.9, {}) }, { stationId: 'B', name: 'B', result: result('unknown', 0.1, null) }]
    expect(distribution(all, 0.7).join('\n')).toMatch(/Coverage at the bar: 50.0% \(1\/2\)/)
  })

  it('compares the classifier with pathways on 2-track stations', () => {
    const all = [{ stationId: 'AAA', name: 'A', result: result('cut-cover-mezzanine', 0.9, { platformType: 'island' }) }]
    const topo = new Map([['AAA', { gtfsStationId: 'AAA', platformNodes: [], hasMezzanine: false, mezzanineCount: 0, perDirection: true, sharedConnector: false }]])
    const text = pathwaysReport(all, topo).join('\n')
    expect(text).toMatch(/hasMezzanine: agree 0.0% \(0\/1\)/)
    expect(text).toMatch(/sharedConnector.*: agree 0.0% \(0\/1\)/)
    expect(text).toMatch(/perDirection \(shallow-per-direction.*: agree 0.0% \(0\/1\)/)
  })
})
