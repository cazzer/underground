import { describe, expect, it } from 'vitest'
import type { AlertEntity, AlertsSnapshot, ServiceAlert } from '../../data/realtime'
import type { TripPattern } from '../../data/schema'
import type { Station } from '../network'
import { ALERTS_MAX_AGE_S } from './alertJoin'
import { alertSkipsOf, arrivalSkipNote, markSkips, skipAt, skipStopText, stationHasSkip, trainLine } from './alertSkips'
import type { TrainStop } from './trainStops'

const NOW = 1_000_000

const station = (id: string, name: string, x: number, routeIds: string[] = ['1']): Station => ({
  id,
  name,
  pos: { x, z: 0 },
  routeIds,
  stops: [`${id}N`, `${id}S`],
  access: { status: 'none' },
  leadId: id,
})
const STATIONS = [
  station('a', 'Alpha St', 0),
  station('b', 'Beta St', 100),
  station('c', 'Gamma St', 200),
  station('d', 'Delta St', 300),
  station('e', 'Epsilon St', 400),
  station('s', 'Six Av', 500, ['6', '6X']),
  station('t', 'Seven Av', 600, ['6', '6X']),
]
const stationById = new Map(STATIONS.map((s) => [s.id, s]))

const stop = (route: string, id: string, direction: AlertEntity['direction'] = null): AlertEntity => ({ route, stop: id, direction })
const alert = (over: Partial<ServiceAlert> = {}): ServiceAlert => ({
  id: 'lmm:planned_work:1',
  type: 'Planned - Stops Skipped',
  header: 'Downtown [1] skips Beta St',
  periods: [[NOW - 100, NOW + 1000]],
  entities: [stop('1', 'a', 'S'), stop('1', 'b', 'S'), stop('1', 'c', 'S')],
  ...over,
})
const snapshot = (alerts: ServiceAlert[], generatedAt = NOW - 10): AlertsSnapshot => ({ version: 1, generatedAt, dropped: 0, alerts })
const skipsOf = (alerts: ServiceAlert[], generatedAt?: number) => alertSkipsOf(snapshot(alerts, generatedAt), false, stationById)

describe('alertSkipsOf', () => {
  it('is null without a snapshot or on a schema mismatch', () => {
    expect(alertSkipsOf(null, false, stationById)).toBeNull()
    expect(alertSkipsOf(snapshot([alert()]), true, stationById)).toBeNull()
  })

  it('ignores alerts that are not skips', () => {
    const skips = skipsOf([alert({ type: 'Delays' }), alert({ type: 'Planned - Part Suspended' })])
    expect(skipAt(skips, '1', 'S', ['b'], NOW)).toBeNull()
  })
})

describe('skipAt', () => {
  it('marks the named station for the alert direction only', () => {
    const skips = skipsOf([alert()])
    expect(skipAt(skips, '1', 'S', ['b'], NOW)).toBe('skips')
    expect(skipAt(skips, '1', 'N', ['b'], NOW)).toBeNull()
  })

  it('leaves a station the alert lists but the header does not name, and other routes, alone', () => {
    const skips = skipsOf([alert()])
    expect(skipAt(skips, '1', 'S', ['a'], NOW)).toBeNull()
    expect(skipAt(skips, '2', 'S', ['b'], NOW)).toBeNull()
  })

  it('covers both directions for an alert with no direction, and a train of unknown direction only then', () => {
    const both = skipsOf([alert({ entities: [stop('1', 'a'), stop('1', 'b'), stop('1', 'c')] })])
    expect(skipAt(both, '1', 'N', ['b'], NOW)).toBe('skips')
    expect(skipAt(both, '1', 'S', ['b'], NOW)).toBe('skips')
    expect(skipAt(both, '1', null, ['b'], NOW)).toBe('skips')
    expect(skipAt(skipsOf([alert()]), '1', null, ['b'], NOW)).toBeNull()
  })

  it('treats a mixed-direction alert as a guess for both directions, never a named skip', () => {
    const skips = skipsOf([alert({ entities: [stop('1', 'a', 'N'), stop('1', 'b', 'S'), stop('1', 'c', 'S')] })])
    expect(skipAt(skips, '1', 'N', ['b'], NOW)).toBe('probably')
    expect(skipAt(skips, '1', 'S', ['b'], NOW)).toBe('probably')
    const partlyNull = skipsOf([alert({ entities: [stop('1', 'a'), stop('1', 'b', 'S'), stop('1', 'c', 'S')] })])
    expect(skipAt(partlyNull, '1', 'N', ['b'], NOW)).toBe('probably')
  })

  it("covers an express by its line's alert, not the line by the express's", () => {
    const six = skipsOf([alert({ header: 'Downtown [6] skips Six Av', entities: [stop('6', 'a', 'S'), stop('6', 's', 'S'), stop('6', 't', 'S')] })])
    expect(skipAt(six, '6', 'S', ['s'], NOW)).toBe('skips')
    expect(skipAt(six, '6X', 'S', ['s'], NOW)).toBe('skips')
    const sixX = skipsOf([alert({ header: 'Downtown [6X] skips Six Av', entities: [stop('6X', 'a', 'S'), stop('6X', 's', 'S'), stop('6X', 't', 'S')] })])
    expect(skipAt(sixX, '6X', 'S', ['s'], NOW)).toBe('skips')
    expect(skipAt(sixX, '6', 'S', ['s'], NOW)).toBeNull()
  })

  it('is in effect from a period start to its end, open-ended without one', () => {
    const at = (periods: ServiceAlert['periods'], nowS = NOW) => skipAt(skipsOf([alert({ periods })]), '1', 'S', ['b'], nowS)
    expect(at([[NOW, NOW + 10]])).toBe('skips')
    expect(at([[NOW, null]], NOW + 100)).toBe('skips')
    expect(at([[NOW + 1, NOW + 10]])).toBeNull()
    expect(at([[NOW - 100, NOW]])).toBeNull()
    expect(at([[NOW - 100, NOW - 50], [NOW - 10, NOW + 10]])).toBe('skips')
  })

  it('is null once the snapshot is older than the alerts limit, and without an index', () => {
    const skips = skipsOf([alert({ periods: [[NOW - 100, null]] })])
    expect(skipAt(skips, '1', 'S', ['b'], NOW - 10 + ALERTS_MAX_AGE_S)).toBe('skips')
    expect(skipAt(skips, '1', 'S', ['b'], NOW - 10 + ALERTS_MAX_AGE_S + 1)).toBeNull()
    expect(skipAt(null, '1', 'S', ['b'], NOW)).toBeNull()
  })

  it('answers a complex by any member', () => {
    const skips = skipsOf([alert()])
    expect(skipAt(skips, '1', 'S', ['a', 'b'], NOW)).toBe('skips')
    expect(skipAt(skips, '1', 'S', ['d', 'e'], NOW)).toBeNull()
  })

  it('a guessed skip is probably, and a named one beats it', () => {
    // No station name in the header: the set is the informed stops less the stretch's two ends.
    const guessed = alert({ id: 'g', header: 'Trains run express', entities: [stop('1', 'a', 'S'), stop('1', 'b', 'S'), stop('1', 'c', 'S')] })
    expect(skipAt(skipsOf([guessed]), '1', 'S', ['b'], NOW)).toBe('probably')
    expect(skipAt(skipsOf([guessed, alert()]), '1', 'S', ['b'], NOW)).toBe('skips')
    expect(skipAt(skipsOf([alert(), guessed]), '1', 'S', ['b'], NOW)).toBe('skips')
  })
})

describe('stationHasSkip', () => {
  it('is true when any listed route skips the station in some direction', () => {
    const skips = skipsOf([alert()])
    expect(stationHasSkip(skips, ['2', '1'], ['b'], NOW)).toBe(true)
    expect(stationHasSkip(skips, ['2'], ['b'], NOW)).toBe(false)
    expect(stationHasSkip(skips, ['1'], ['a'], NOW)).toBe(false)
    expect(stationHasSkip(null, ['1'], ['b'], NOW)).toBe(false)
  })
})

describe('trainLine', () => {
  const patterns: Record<string, TripPattern> = { '1..S03R': { routeId: '1', direction: 'S', stops: [] } }
  const routes = new Map([['1', 1]])
  const trip = (over: { route?: string; direction?: 'N' | 'S' | null; first?: string }, shapeId: string) => ({
    shapeId,
    trip: { route: over.route ?? '1', direction: over.direction ?? null, arrivals: over.first ? [[over.first, NOW] as [string, number]] : [] },
  })
  const line = (t: ReturnType<typeof trip>) => trainLine(t as unknown as Parameters<typeof trainLine>[0], routes, patterns)

  it("takes the joined pattern's direction first", () => {
    expect(line(trip({ direction: 'N', first: 'bN' }, '1..S03R'))).toEqual({ route: '1', direction: 'S' })
  })
  it("falls back to the feed's direction, then the first stop's suffix, then unknown", () => {
    expect(line(trip({ direction: 'N' }, 'none'))).toEqual({ route: '1', direction: 'N' })
    expect(line(trip({ first: 'bS' }, 'none'))).toEqual({ route: '1', direction: 'S' })
    expect(line(trip({}, 'none'))).toEqual({ route: '1', direction: null })
  })
})

describe('markSkips', () => {
  const stops: TrainStop[] = [
    { stopId: 'bS', name: 'Beta St', time: NOW, standing: true },
    { stopId: 'cS', name: 'Gamma St', time: NOW + 60, standing: false },
  ]
  it('marks by station, never the stop the train stands at', () => {
    const marked = markSkips(stops, () => 'skips')
    expect(marked.map((s) => s.skip)).toEqual([null, 'skips'])
    expect(markSkips(stops, (id) => (id === 'c' ? 'probably' : null)).map((s) => s.skip)).toEqual([null, 'probably'])
  })
})

describe('texts', () => {
  it('words a skipped stop for the eye and the ear', () => {
    expect(skipStopText('125 St', 'skips')).toEqual({ note: 'skips · per MTA notice', spoken: 'skips 125 St, per MTA notice' })
    expect(skipStopText('125 St', 'probably')).toEqual({ note: 'probably skips · per MTA notice', spoken: 'probably skipped, per MTA notice' })
  })
  it('words the arrivals note without the source', () => {
    expect(arrivalSkipNote('skips')).toBe('skips this station')
    expect(arrivalSkipNote('probably')).toBe('probably skips this station')
  })
})
