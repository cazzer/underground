import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import { deriveArrivalsView, sectionsByDirection } from './arrivalsView'
import type { StationFeedHealth } from './feedHealth'
import type { LiveStatus, LiveStatusKind } from './liveStatus'

const status = (kind: LiveStatusKind): LiveStatus => ({ kind, label: kind, detail: null })
const group = (direction: 'N' | 'S', routeId = 'L'): ArrivalGroup => ({ routeId, direction, headsign: '8 Av', times: [100] })
const ok: StationFeedHealth = { unavailable: [], delayed: false }
const view = (s: LiveStatusKind, groups: ArrivalGroup[] | null, health: StationFeedHealth | null = ok) =>
  deriveArrivalsView(status(s), groups, health, (id) => id)

describe('deriveArrivalsView', () => {
  it('says off, whatever the data', () => {
    expect(view('off', [group('N')])).toEqual({ kind: 'message', text: 'Live arrivals not available yet' })
  })
  it('says connecting until there is something to read', () => {
    expect(view('connecting', null, null)).toEqual({ kind: 'message', text: 'Connecting to live arrivals' })
  })
  it('says unavailable on error', () => {
    expect(view('error', null, null)).toEqual({ kind: 'message', text: 'Live arrivals unavailable' })
  })
  it('shows one section per direction with no notes when healthy', () => {
    const [n, s] = [group('N'), group('S')]
    expect(view('live', [n, s])).toEqual({ kind: 'rows', sections: [[n], [s]], notes: [] })
  })
  it('is explicit when nothing is coming and every feed is fine', () => {
    expect(view('live', [])).toEqual({ kind: 'empty', notes: [] })
  })
  it('keeps showing times when delayed, with a note', () => {
    const g = group('N')
    expect(view('stale', [g], { unavailable: [], delayed: true })).toEqual({ kind: 'rows', sections: [[g]], notes: ['Times may be delayed'] })
    expect(view('stale', [], { unavailable: [], delayed: true })).toEqual({ kind: 'empty', notes: ['Times may be delayed'] })
  })
  it('names the routes whose feed failed and never calls that "no trains"', () => {
    const health = { unavailable: ['F', 'M'], delayed: true }
    expect(view('stale', [], health)).toEqual({
      kind: 'rows',
      sections: [],
      notes: ['Live times unavailable for F, M', 'Times may be delayed'],
    })
    const g = group('S', 'A')
    expect(view('stale', [g], { unavailable: ['F'], delayed: false })).toEqual({
      kind: 'rows',
      sections: [[g]],
      notes: ['Live times unavailable for F'],
    })
  })
})

describe('sectionsByDirection', () => {
  it('starts a new section where the direction changes', () => {
    const [a, b, c] = [group('N', 'A'), group('N', 'B'), group('S', 'C')]
    expect(sectionsByDirection([a, b, c])).toEqual([[a, b], [c]])
    expect(sectionsByDirection([])).toEqual([])
  })
})
