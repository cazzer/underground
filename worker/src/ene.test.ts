import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseNyTime, transformEne } from './ene'
import { ENE_SCHEMA_VERSION } from './schema'

/** Recorded 2026-11-22 05:10:06 GMT (see fixtures/README.md). */
const GENERATED_AT = 1795324206

type Row = Record<string, unknown>
const fixture = JSON.parse(readFileSync(new URL('../fixtures/ene.json', import.meta.url), 'utf8')) as Row[]
const row = (code: string, n = 0): Row => fixture.filter((r) => r.equipment === code)[n] as Row

const EXPECTED = [
  { code: 'EL290X', reason: 'Repair', since: 1730111160, returnAt: 1798776000 },
  { code: 'EL381', reason: 'Inspection', since: 1795316400, returnAt: 1795345200 },
  { code: 'EL738', reason: 'Maintenance', since: 1795323600, returnAt: 1795345200 },
  { code: 'ES112', reason: 'Maintenance', since: 1795323000, returnAt: 1795345200 },
  // Past its return time: overdue rows stay until the feed drops them.
  { code: 'ES340', reason: 'Planned Work', since: 1795293000, returnAt: 1795320000 },
]

describe('parseNyTime', () => {
  it('reads New York local times as epoch seconds', () => {
    expect(parseNyTime('11/22/2026 12:00:00 AM')).toBe(1795323600)
    expect(parseNyTime('10/28/2024 06:26:00 AM')).toBe(1730111160)
    expect(parseNyTime('11/22/2026 12:00:00 PM')).toBe(1795366800)
    expect(parseNyTime('07/04/2026 12:00:00 AM')).toBe(1783137600)
  })

  it('reads a time inside the spring-forward gap with the daylight offset (an hour earlier on the wall clock)', () => {
    // 02:30 does not exist on 03/08/2026; 1772951400 is 06:30 UTC = 01:30 EST.
    expect(parseNyTime('03/08/2026 02:30:00 AM')).toBe(1772951400)
  })

  it('takes the first occurrence of an ambiguous fall-back time', () => {
    expect(parseNyTime('11/01/2026 01:30:00 AM')).toBe(1793511000)
  })

  it('rejects anything that is not exactly the format or a real date', () => {
    for (const bad of [
      '',
      '13/01/2026 01:00:00 AM',
      '02/30/2026 01:00:00 AM',
      '11/22/2026 00:00:00 AM',
      '11/22/2026 13:00:00 PM',
      '11/22/2026 01:60:00 AM',
      '2026-11-22T00:00',
      ' 11/22/2026 12:00:00 AM',
    ]) {
      expect(parseNyTime(bad), bad).toBeNull()
    }
  })
})

describe('transformEne', () => {
  it('keeps the outages in effect, one per code, sorted by code', () => {
    const { snapshot, upcoming, duplicates } = transformEne(fixture, GENERATED_AT)
    expect(snapshot.version).toBe(ENE_SCHEMA_VERSION)
    expect(snapshot.generatedAt).toBe(GENERATED_AT)
    expect(snapshot.dropped).toBe(0)
    expect(upcoming).toBe(3)
    expect(duplicates).toBe(0)
    expect(snapshot.outages).toEqual(EXPECTED)
  })

  it('drops and counts malformed rows without losing the good ones', () => {
    const el738 = row('EL738')
    const rows = [
      ...fixture,
      null,
      42,
      {},
      { ...el738, equipment: '' },
      { ...el738, equipment: 7 },
      { ...el738, equipment: 'el1' },
      { ...el738, equipment: 'EL999', outagedate: 'soon' },
    ]
    const { snapshot } = transformEne(rows, GENERATED_AT)
    expect(snapshot.dropped).toBe(7)
    expect(snapshot.outages).toEqual(EXPECTED)
  })

  it('keeps a row whose return time is missing or unparseable, with a null returnAt', () => {
    for (const bad of ['', 'TBD', 5]) {
      const { snapshot } = transformEne([{ ...row('EL738'), estimatedreturntoservice: bad }], GENERATED_AT)
      expect(snapshot.dropped).toBe(0)
      expect(snapshot.outages).toEqual([{ code: 'EL738', reason: 'Maintenance', since: 1795323600, returnAt: null }])
    }
  })

  it('nulls an empty or non-string reason and caps a long one', () => {
    const reasons = ['', 12, '  ', 'x'.repeat(300)].map((reason, i) => ({ ...row('EL738'), equipment: `EL10${i}`, reason }))
    const { snapshot } = transformEne(reasons, GENERATED_AT)
    expect(snapshot.outages.map((o) => o.reason)).toEqual([null, null, null, 'x'.repeat(100)])
  })

  it('cleans a reason: collapses whitespace, strips control and bidi characters, caps by code point', () => {
    const reasons = [
      'Re‮pair\u0000  \n work​',
      '‮\u0007',
      `${'x'.repeat(99)}😀y`,
      `${'x'.repeat(98)}😀😀`,
    ].map((reason, i) => ({ ...row('EL738'), equipment: `EL10${i}`, reason }))
    const { snapshot } = transformEne(reasons, GENERATED_AT)
    expect(snapshot.outages.map((o) => o.reason)).toEqual([
      'Repair work',
      null,
      `${'x'.repeat(99)}😀`,
      `${'x'.repeat(98)}😀😀`,
    ])
  })

  it('keeps the earliest since when a code appears twice in effect', () => {
    const later = { ...row('EL738'), outagedate: '11/22/2026 12:05:00 AM', reason: 'Repair' }
    for (const rows of [[row('EL738'), later], [later, row('EL738')]]) {
      const { snapshot, duplicates } = transformEne(rows, GENERATED_AT)
      expect(duplicates).toBe(1)
      expect(snapshot.outages).toEqual([EXPECTED[2]])
    }
  })

  it('includes an upcoming-flagged outage once it has started', () => {
    // EL783 starts 11/22/2026 10:00 PM New York = 1795399200.
    expect(transformEne(fixture, GENERATED_AT).snapshot.outages.map((o) => o.code)).not.toContain('EL783')
    expect(transformEne(fixture, 1795417200).snapshot.outages.map((o) => o.code)).toContain('EL783')
  })

  it('ignores the upcoming flag: a not-yet-started row is skipped even when flagged N', () => {
    const future = { ...row('EL738'), equipment: 'EL555', outagedate: '11/29/2026 10:00:00 PM', isupcomingoutage: 'N' }
    const { snapshot, upcoming } = transformEne([future], GENERATED_AT)
    expect(snapshot.outages).toEqual([])
    expect(snapshot.dropped).toBe(0)
    expect(upcoming).toBe(1)
  })

  it('throws on a top level that is not an array', () => {
    expect(() => transformEne({}, GENERATED_AT)).toThrow(TypeError)
    expect(() => transformEne(null, GENERATED_AT)).toThrow(TypeError)
  })
})
