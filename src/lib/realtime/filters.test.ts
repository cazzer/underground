import { describe, expect, it } from 'vitest'
import type { RealtimeTrip } from '../../data/realtime'
import { ghostReason } from './filters'

const NOW = 1_795_228_554

function trip(over: Partial<RealtimeTrip> = {}): RealtimeTrip {
  return {
    route: '1',
    direction: 'N',
    tripId: '129600_1..N03R',
    startDate: '20261120',
    trainId: null,
    assigned: true,
    stopId: '101N',
    status: 'IN_TRANSIT_TO',
    timestamp: NOW - 20,
    arrivals: [['101N', NOW + 30]],
    ...over,
  }
}

describe('ghostReason', () => {
  it('keeps a healthy trip', () => {
    expect(ghostReason(trip(), NOW)).toBeNull()
  })
  it('drops unassigned trips', () => {
    expect(ghostReason(trip({ assigned: false }), NOW)).toBe('unassigned')
  })
  it('keeps an assigned trip with no VehiclePosition timestamp', () => {
    expect(ghostReason(trip({ timestamp: null }), NOW)).toBeNull()
  })
  it('drops a stale vehicle position at 1800 s', () => {
    expect(ghostReason(trip({ timestamp: NOW - 1801 }), NOW)).toBe('stale-vehicle')
    expect(ghostReason(trip({ timestamp: NOW - 1799 }), NOW)).toBeNull()
  })
  it('keeps a vehicle timestamp from the future (clock skew)', () => {
    expect(ghostReason(trip({ timestamp: NOW + 30 }), NOW)).toBeNull()
  })
  it('drops trips with no arrival still ahead, allowing 60 s of grace', () => {
    expect(ghostReason(trip({ arrivals: [] }), NOW)).toBe('no-future-arrival')
    expect(ghostReason(trip({ arrivals: [['101N', NOW - 61]] }), NOW)).toBe('no-future-arrival')
    expect(ghostReason(trip({ arrivals: [['101N', NOW - 59]] }), NOW)).toBeNull()
  })
})
