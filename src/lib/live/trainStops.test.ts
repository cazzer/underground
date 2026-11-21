import { describe, expect, it } from 'vitest'
import type { RealtimeTrip } from '../../data/realtime'
import { DELAYED_NOTE } from './arrivalsView'
import type { LiveStatus, LiveStatusKind } from './liveStatus'
import { deriveTrainStopsView, nextStops, nyClockTime, stopEta, type TrainStop } from './trainStops'

const NOW = 1_000_000
const names: Record<string, string> = { L08: 'Bedford Av', L06: '1 Av', L05: '3 Av' }
const nameOf = (id: string) => names[id]

type Trip = Pick<RealtimeTrip, 'arrivals' | 'status' | 'stopId'>
const trip = (arrivals: [string, number][], status: Trip['status'] = 'IN_TRANSIT_TO'): Trip => ({
  arrivals,
  status,
  stopId: arrivals[0]?.[0] ?? null,
})

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
  it('keeps the stop a train is stopped at however long it dwells', () => {
    const stopped = trip([['L08N', NOW - 200], ['L06N', NOW + 60]], 'STOPPED_AT')
    expect(nextStops(stopped, NOW, nameOf).map((s) => s.stopId)).toEqual(['L08N', 'L06N'])
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

describe('nyClockTime', () => {
  it('reads EST in winter', () => {
    expect(nyClockTime(Date.parse('2026-11-21T17:41:00Z') / 1000)).toBe('12:41')
  })
  it('reads EDT in summer', () => {
    expect(nyClockTime(Date.parse('2026-07-04T17:41:00Z') / 1000)).toBe('1:41')
  })
  it('follows the clocks across the November change', () => {
    expect(nyClockTime(Date.parse('2026-11-01T05:30:00Z') / 1000)).toBe('1:30')
    expect(nyClockTime(Date.parse('2026-11-01T07:30:00Z') / 1000)).toBe('2:30')
  })
  it('reads midnight as 12, not 0', () => {
    expect(nyClockTime(Date.parse('2026-11-21T05:05:00Z') / 1000)).toBe('12:05')
  })
  it('has no AM or PM', () => {
    expect(nyClockTime(Date.parse('2026-11-21T20:07:00Z') / 1000)).toBe('3:07')
  })
})

describe('stopEta', () => {
  const at = (s: number) => stopEta(NOW + s, NOW).away
  it('reads Now under 30 s and when already past', () => {
    expect(at(29)).toBe('Now')
    expect(at(-20)).toBe('Now')
  })
  it('reads a minute at 30 s', () => {
    expect(at(30)).toBe('1 min')
  })
  it('rounds whole minutes down', () => {
    expect(at(3 * 60 + 59)).toBe('3 min')
  })
  it('carries the clock time', () => {
    expect(stopEta(Date.parse('2026-11-21T17:41:00Z') / 1000, 0).clock).toBe('12:41')
  })
})

describe('deriveTrainStopsView', () => {
  const status = (kind: LiveStatusKind): LiveStatus => ({ kind, label: kind, detail: null })
  const stops: TrainStop[] = [{ stopId: 'L08N', name: 'Bedford Av', time: NOW }]
  it('says connecting until there is a snapshot', () => {
    expect(deriveTrainStopsView(status('connecting'), null, false)).toEqual({ kind: 'message', text: 'Connecting to live times' })
  })
  it('says off and error outright', () => {
    expect(deriveTrainStopsView(status('off'), stops, false).kind).toBe('message')
    expect(deriveTrainStopsView(status('error'), stops, false).kind).toBe('message')
  })
  it('keeps rows under a note when the connection is stale', () => {
    expect(deriveTrainStopsView(status('stale'), stops, false)).toEqual({ kind: 'rows', stops, notes: [DELAYED_NOTE] })
  })
  it('keeps rows under a note when only this train feed is stale', () => {
    expect(deriveTrainStopsView(status('live'), stops, true)).toEqual({ kind: 'rows', stops, notes: [DELAYED_NOTE] })
  })
  it('is explicit when no stops remain', () => {
    expect(deriveTrainStopsView(status('live'), [], false)).toEqual({ kind: 'empty', notes: [] })
  })
  it('shows rows with no notes when healthy', () => {
    expect(deriveTrainStopsView(status('live'), stops, false)).toEqual({ kind: 'rows', stops, notes: [] })
  })
})
