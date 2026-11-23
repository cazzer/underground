import { describe, expect, it } from 'vitest'
import type { AlertEntity, AlertsSnapshot, ServiceAlert } from '../../data/realtime'
import type { AlertsInput } from './alertJoin'
import { alertChip, alertListView, laterWhen, type AlertListBody } from './alertList'

/** Epoch seconds of a New York wall time on 2026-11-`day` (EST, UTC-5: the clocks went back on Nov 1). */
const est = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour + 5, minute) / 1000
const NOW = est(23, 14, 30) // Monday 2:30 PM
const DAY = 86_400

const ORDER = new Map([['1', 0], ['2', 1], ['6', 2], ['7', 3], ['A', 4]])
const route = (r: string): AlertEntity => ({ route: r, stop: null, direction: null })
const alert = (over: Partial<ServiceAlert> = {}): ServiceAlert => ({
  id: 'lmm:planned_work:1',
  type: 'Delays',
  header: 'Some trains are delayed',
  periods: [[NOW - 100, NOW + 3600]],
  entities: [route('1')],
  ...over,
})
const feed = (alerts: ServiceAlert[], over: Partial<AlertsInput> = {}, generatedAt = NOW - 10): AlertsInput => ({
  configured: true,
  snapshot: { version: 1, generatedAt, dropped: 0, alerts } satisfies AlertsSnapshot,
  failures: 0,
  schemaMismatch: false,
  ...over,
})
const list = (alerts: ServiceAlert[], nowS = NOW) => {
  const body = alertListView(feed(alerts), ORDER, nowS, NEVER)
  if (body.kind !== 'list') throw new Error(`expected a list, got ${body.kind}`)
  return body
}
/** No row drawable, unless a test says otherwise. */
const NEVER = () => false
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('alertListView status', () => {
  it('is off when not configured', () => {
    expect(alertListView({ configured: false, snapshot: null, failures: 0, schemaMismatch: false }, ORDER, NOW, NEVER)).toEqual({ kind: 'off' })
  })

  it('is connecting with no snapshot and under two failures', () => {
    for (const failures of [0, 1]) expect(alertListView({ configured: true, snapshot: null, failures, schemaMismatch: false }, ORDER, NOW, NEVER)).toEqual({ kind: 'connecting' })
  })

  it('is unknown after two failures with no snapshot', () => {
    expect(alertListView({ configured: true, snapshot: null, failures: 2, schemaMismatch: false }, ORDER, NOW, NEVER)).toEqual({ kind: 'unknown' })
  })

  it('is unknown when the snapshot is over 480 s old, but not at 480', () => {
    expect(alertListView(feed([alert()], {}, NOW - 481), ORDER, NOW, NEVER)).toEqual({ kind: 'unknown' })
    expect(alertListView(feed([alert()], {}, NOW - 480), ORDER, NOW, NEVER).kind).toBe('list')
  })

  it('is unknown on a schema mismatch, even with a fresh snapshot', () => {
    expect(alertListView(feed([alert()], { schemaMismatch: true }), ORDER, NOW, NEVER)).toEqual({ kind: 'unknown' })
  })

  it('keeps a stale snapshot unknown, never an empty list', () => {
    expect(alertListView(feed([], {}, NOW - 600), ORDER, NOW, NEVER)).toEqual({ kind: 'unknown' })
  })
})

describe('alertListView groups', () => {
  it('puts an alert in effect under Now with "Until" and its end as the sort key', () => {
    const { now, later } = list([alert()])
    expect(later).toEqual([])
    expect(now).toEqual([{ id: 'lmm:planned_work:1', routeIds: ['1'], header: 'Some trains are delayed', when: 'Until 3:30 PM', atS: NOW + 3600, drawable: false }])
  })

  it('says nothing for an open-ended period, and for one with no start (the heading says Now)', () => {
    expect(list([alert({ periods: [[0, null]] })]).now[0]).toMatchObject({ when: '', atS: null })
    expect(list([alert({ periods: [[NOW - 5, null]] })]).now[0]!.when).toBe('')
  })

  it('words an end on another day', () => {
    expect(list([alert({ periods: [[NOW - 5, est(24, 5)]] })]).now[0]!.when).toBe('Until tomorrow 5 AM')
  })

  it('puts an alert starting within 24 h under Later, and drops one starting at +24 h exactly', () => {
    const { now, later } = list([
      alert({ id: 'in', periods: [[NOW + 600, NOW + 5000]] }),
      alert({ id: 'edge', periods: [[NOW + DAY, NOW + DAY + 100]] }),
      alert({ id: 'last-second', periods: [[NOW + DAY - 1, null]] }),
    ])
    expect(now).toEqual([])
    expect(ids(later)).toEqual(['in', 'last-second'])
  })

  it('drops an alert whose only period has ended', () => {
    const body = list([alert({ periods: [[NOW - 5000, NOW - 1]] }), alert({ id: 'ended-now', periods: [[NOW - 5000, NOW]] })])
    expect(body).toEqual({ kind: 'list', now: [], later: [] })
  })

  it('with several periods, is Now by the period in force, else Later by the earliest future start', () => {
    const periods: ServiceAlert['periods'] = [[NOW - 9000, NOW - 4000], [NOW - 100, NOW + 100], [NOW + 7200, null]]
    expect(list([alert({ periods })]).now[0]!.atS).toBe(NOW + 100)
    const gap: ServiceAlert['periods'] = [[NOW - 9000, NOW - 4000], [NOW + 9000, NOW + 9500], [NOW + 3000, NOW + 3500]]
    const { now, later } = list([alert({ periods: gap.sort((a, b) => a[0] - b[0]) })])
    expect(now).toEqual([])
    expect(later[0]!.atS).toBe(NOW + 3000)
  })

  it('copies the header unchanged, newlines and all', () => {
    const header = 'Downtown [1] skips 137 St\n\nUse the [2] instead.  '
    expect(list([alert({ header })]).now[0]!.header).toBe(header)
  })
})

describe('alertListView routes and order', () => {
  it('folds expresses into their line, dedupes and orders by route order, unknown ids last', () => {
    const entities = [route('A'), route('6X'), route('ZZ'), route('6'), route('1'), route('AA'), route('7X'), route('7')]
    expect(list([alert({ entities })]).now[0]!.routeIds).toEqual(['1', '6', '7', 'A', 'AA', 'ZZ'])
  })

  it('has no routes for an alert with no entities', () => {
    expect(list([alert({ entities: [] })]).now[0]!.routeIds).toEqual([])
  })

  it('sorts Now by first route, then id', () => {
    const { now } = list([
      alert({ id: 'c', entities: [route('2')] }),
      alert({ id: 'b', entities: [route('A')] }),
      alert({ id: 'a2', entities: [route('1')] }),
      alert({ id: 'a1', entities: [route('1')] }),
      alert({ id: 'none', entities: [] }),
    ])
    expect(ids(now)).toEqual(['a1', 'a2', 'c', 'b', 'none'])
  })

  it('sorts Later by start, then first route, then id', () => {
    const { later } = list([
      alert({ id: 'late', periods: [[NOW + 9000, null]], entities: [route('1')] }),
      alert({ id: 'b', periods: [[NOW + 600, null]], entities: [route('A')] }),
      alert({ id: 'a', periods: [[NOW + 600, null]], entities: [route('2')] }),
      alert({ id: 'z', periods: [[NOW + 600, null]], entities: [route('2')] }),
    ])
    expect(ids(later)).toEqual(['a', 'z', 'b', 'late'])
  })
})

describe('laterWhen', () => {
  it('says Today before 6 PM and Tonight from then, with New York minutes', () => {
    expect(laterWhen(est(23, 17, 59), NOW)).toBe('Today 5:59 PM')
    expect(laterWhen(est(23, 18), NOW)).toBe('Tonight 6 PM')
    expect(laterWhen(est(23, 23, 45), NOW)).toBe('Tonight 11:45 PM')
    expect(laterWhen(est(23, 14, 30) + 60, NOW)).toBe('Today 2:31 PM')
  })

  it('says Tomorrow for the next New York day, including just after midnight', () => {
    expect(laterWhen(est(24, 4), NOW)).toBe('Tomorrow 4 AM')
    expect(laterWhen(est(24, 0, 5), NOW)).toBe('Tomorrow 12:05 AM')
  })

  it('reads New York time across the November fall-back', () => {
    const now = Date.UTC(2026, 10, 1, 4, 30) / 1000 // Nov 1 12:30 AM EDT
    expect(laterWhen(est(1, 20), now)).toBe('Tonight 8 PM')
    expect(laterWhen(est(1, 9, 15), now)).toBe('Today 9:15 AM')
  })

  it('capitalises the station panel wording beyond tomorrow', () => {
    expect(laterWhen(est(26, 10), NOW)).toBe('Thu 10 AM')
    expect(laterWhen(est(30, 10), NOW)).toBe('Nov 30')
  })
})

describe('alertChip', () => {
  const row = (id: string) => ({ id, routeIds: [], header: id, when: '', atS: null, drawable: false })
  const chip = (body: AlertListBody, open = false) => alertChip(body, open)

  it('is null when off, and when connecting or empty with the panel closed', () => {
    expect(chip({ kind: 'off' })).toBeNull()
    expect(chip({ kind: 'off' }, true)).toBeNull()
    expect(chip({ kind: 'connecting' })).toBeNull()
    expect(chip({ kind: 'list', now: [], later: [] })).toBeNull()
  })

  it('keeps the chip as the toggle while the panel is open', () => {
    expect(chip({ kind: 'connecting' }, true)).toEqual({ text: 'Service changes', mark: false })
    expect(chip({ kind: 'list', now: [], later: [] }, true)).toEqual({ text: 'No service changes', mark: false })
  })

  it('says unavailable with no mark, open or not', () => {
    expect(chip({ kind: 'unknown' })).toEqual({ text: 'Service changes unavailable', mark: false })
    expect(chip({ kind: 'unknown' }, true)).toEqual({ text: 'Service changes unavailable', mark: false })
  })

  it('counts the changes in effect, singular and plural, marked', () => {
    expect(chip({ kind: 'list', now: [row('a')], later: [row('b')] })).toEqual({ text: '1 service change', mark: true })
    expect(chip({ kind: 'list', now: [row('a'), row('b'), row('c')], later: [] })).toEqual({ text: '3 service changes', mark: true })
  })

  it('counts the ones coming when none is in effect', () => {
    expect(chip({ kind: 'list', now: [], later: [row('a'), row('b')] })).toEqual({ text: '2 service changes later', mark: true })
    expect(chip({ kind: 'list', now: [], later: [row('a')] })).toEqual({ text: '1 service change later', mark: true })
  })
})
