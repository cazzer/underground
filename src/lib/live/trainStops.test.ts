import { describe, expect, it } from 'vitest'
import { STALE_AFTER_S, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import { DELAYED_NOTE } from './arrivalsView'
import type { LiveStatus, LiveStatusKind } from './liveStatus'
import {
  deriveTrainStopsView,
  isCutShort,
  nextStops,
  nyClockTime,
  stopEta,
  stopEtaSpoken,
  tripTimesDelayed,
  type TrainStop,
} from './trainStops'

const NOW = 1_000_000
const names: Record<string, string> = { L08: 'Bedford Av', L06: '1 Av', L05: '3 Av' }
const nameOf = (id: string) => names[id]

type Trip = Pick<RealtimeTrip, 'arrivals' | 'status' | 'stopId'>
const trip = (arrivals: [string, number][], status: Trip['status'] = 'IN_TRANSIT_TO'): Trip => ({
  arrivals,
  status,
  stopId: arrivals[0]?.[0] ?? null,
})
const epoch = (iso: string) => Date.parse(iso) / 1000

describe('nextStops', () => {
  it('drops stops already passed and keeps feed order', () => {
    const stops = nextStops(trip([['L08N', NOW - 120], ['L06N', NOW + 60], ['L05N', NOW + 200]]), NOW, nameOf)
    expect(stops.map((s) => s.stopId)).toEqual(['L06N', 'L05N'])
    expect(stops.map((s) => s.name)).toEqual(['1 Av', '3 Av'])
  })
  it('keeps a stop up to 30 s past, where it reads Now', () => {
    const [stop] = nextStops(trip([['L08N', NOW - 30]]), NOW, nameOf)
    expect(stop).toBeDefined()
    expect(stopEta(stop!.time, NOW).away).toBe('Now')
    expect(nextStops(trip([['L08N', NOW - 31]]), NOW, nameOf)).toEqual([])
  })
  it('keeps the stop a train is stopped at however long it dwells, marked as standing', () => {
    const stopped = trip([['L08N', NOW - 200], ['L06N', NOW + 60]], 'STOPPED_AT')
    const found = nextStops(stopped, NOW, nameOf)
    expect(found.map((s) => s.stopId)).toEqual(['L08N', 'L06N'])
    expect(found.map((s) => s.standing)).toEqual([true, false])
  })
  it('does not keep a past first stop unless the train is stopped there', () => {
    const moving = trip([['L08N', NOW - 200], ['L06N', NOW + 60]], 'IN_TRANSIT_TO')
    expect(nextStops(moving, NOW, nameOf).map((s) => s.stopId)).toEqual(['L06N'])
    const elsewhere: Trip = { ...trip([['L08N', NOW - 200]], 'STOPPED_AT'), stopId: 'L06N' }
    expect(nextStops(elsewhere, NOW, nameOf)).toEqual([])
  })
  it('falls back to the stop id for a station it does not know', () => {
    expect(nextStops(trip([['X99S', NOW + 5]]), NOW, nameOf)[0]!.name).toBe('X99S')
  })
})

describe('isCutShort', () => {
  const stop = (stopId: string): TrainStop => ({ stopId, name: stopId, time: NOW, standing: false })
  it('is true when the list stops before the pattern terminal', () => {
    expect(isCutShort([stop('A'), stop('B')], 'C')).toBe(true)
  })
  it('is false at the terminal, with no terminal known, or with no stops', () => {
    expect(isCutShort([stop('A'), stop('C')], 'C')).toBe(false)
    expect(isCutShort([stop('A')], undefined)).toBe(false)
    expect(isCutShort([], 'C')).toBe(false)
  })
})

describe('tripTimesDelayed', () => {
  const snapshot = (generatedAt: number, lStale: boolean) =>
    ({ version: 1, generatedAt, feeds: { l: { stale: lStale }, ace: { stale: false } } }) as unknown as RealtimeSnapshot
  it('is false for a fresh snapshot and a healthy feed', () => {
    expect(tripTimesDelayed(snapshot(NOW, false), 'l', 0, NOW + 20)).toBe(false)
    expect(tripTimesDelayed(snapshot(NOW, false), 'l', 1, NOW + 20)).toBe(false)
  })
  it('is true after two failed polls', () => {
    expect(tripTimesDelayed(snapshot(NOW, false), 'l', 2, NOW + 20)).toBe(true)
  })
  it('is true once the snapshot is older than the stale limit', () => {
    expect(tripTimesDelayed(snapshot(NOW, false), 'l', 0, NOW + STALE_AFTER_S)).toBe(false)
    expect(tripTimesDelayed(snapshot(NOW, false), 'l', 0, NOW + STALE_AFTER_S + 1)).toBe(true)
  })
  it("follows the train's own feed, not the others", () => {
    expect(tripTimesDelayed(snapshot(NOW, true), 'l', 0, NOW)).toBe(true)
    expect(tripTimesDelayed(snapshot(NOW, true), 'ace', 0, NOW)).toBe(false)
  })
})

describe('nyClockTime', () => {
  it('reads EST in winter', () => {
    expect(nyClockTime(epoch('2026-11-21T17:41:00Z'))).toBe('12:41')
  })
  it('reads EDT in summer', () => {
    expect(nyClockTime(epoch('2026-07-04T17:41:00Z'))).toBe('1:41')
  })
  it('follows the clocks across the November change', () => {
    expect(nyClockTime(epoch('2026-11-01T05:30:00Z'))).toBe('1:30')
    expect(nyClockTime(epoch('2026-11-01T07:30:00Z'))).toBe('2:30')
  })
  it('reads midnight as 12, not 0', () => {
    expect(nyClockTime(epoch('2026-11-21T05:05:00Z'))).toBe('12:05')
  })
  it('has no AM or PM', () => {
    expect(nyClockTime(epoch('2026-11-21T20:07:00Z'))).toBe('3:07')
  })
})

describe('stopEta', () => {
  // On a whole minute, so seconds-away and clock-minutes-away line up in the simple cases.
  const BASE = epoch('2026-11-21T17:40:00Z')
  const at = (s: number) => stopEta(BASE + s, BASE).away
  it('reads Now under 30 s and when already past', () => {
    expect(at(29)).toBe('Now')
    expect(at(-20)).toBe('Now')
  })
  it('reads a minute at 30 s', () => {
    expect(at(30)).toBe('1 min')
  })
  it('counts clock minutes, rounding down', () => {
    expect(at(3 * 60 + 59)).toBe('3 min')
  })
  it('carries the clock time', () => {
    expect(stopEta(epoch('2026-11-21T17:41:00Z'), 0).clock).toBe('12:41')
  })
  it('keeps adjacent rows consistent with their clock times', () => {
    // At 12:44:30, 12:50 is 5.5 min away and 12:52 is 7.5: rounding the distances gives "5 min" and "7 min"
    // beside clocks six and eight minutes on. Counting clock minutes gives 6 and 8.
    const now = epoch('2026-11-21T17:44:30Z')
    const rows = ['17:50:00', '17:52:00', '17:55:00'].map((t) => {
      const eta = stopEta(epoch(`2026-11-21T${t}Z`), now)
      return `${eta.clock} · ${eta.away}`
    })
    expect(rows).toEqual(['12:50 · 6 min', '12:52 · 8 min', '12:55 · 11 min'])
  })
  it('never says 0 min once past the Now window', () => {
    expect(stopEta(epoch('2026-11-21T17:44:50Z'), epoch('2026-11-21T17:44:10Z')).away).toBe('1 min')
  })
})

describe('stopEtaSpoken', () => {
  it('spells out the minutes', () => {
    expect(stopEtaSpoken({ clock: '1:46', away: '2 min' })).toBe('1:46, in 2 minutes')
    expect(stopEtaSpoken({ clock: '1:46', away: '1 min' })).toBe('1:46, in 1 minute')
  })
  it('says only now for a train at the platform', () => {
    expect(stopEtaSpoken({ clock: '1:44', away: 'Now' })).toBe('now')
  })
})

describe('deriveTrainStopsView', () => {
  const status = (kind: LiveStatusKind): LiveStatus => ({ kind, label: kind, detail: null })
  const stops: TrainStop[] = [{ stopId: 'L08N', name: 'Bedford Av', time: NOW, standing: false }]
  it('says connecting until there is a snapshot', () => {
    expect(deriveTrainStopsView(status('connecting'), null, false)).toEqual({ kind: 'message', text: 'Connecting to live times' })
  })
  it('says off and error outright', () => {
    expect(deriveTrainStopsView(status('off'), stops, false).kind).toBe('message')
    expect(deriveTrainStopsView(status('error'), stops, false).kind).toBe('message')
  })
  it('keeps rows under a note when the times are delayed', () => {
    expect(deriveTrainStopsView(status('live'), stops, true)).toEqual({ kind: 'rows', stops, notes: [DELAYED_NOTE] })
  })
  it('does not read the delay off the status, which speaks for every feed', () => {
    expect(deriveTrainStopsView(status('stale'), stops, false)).toEqual({ kind: 'rows', stops, notes: [] })
  })
  it('is explicit when no stops remain', () => {
    expect(deriveTrainStopsView(status('live'), [], false)).toEqual({ kind: 'empty', notes: [] })
  })
  it('shows rows with no notes when healthy', () => {
    expect(deriveTrainStopsView(status('live'), stops, false)).toEqual({ kind: 'rows', stops, notes: [] })
  })
})
