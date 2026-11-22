import { describe, expect, it } from 'vitest'
import { dismissLocate, failLocating, failureFromCode, lastPlacement, markedPlacement, placeFix, startLocating, toFix, type LocateState, type Placement, APPROXIMATE_M, FAR_VIEW_PADDING, MIN_VIEW_RADIUS_M, NEAREST_IN_VIEW_CAP_M } from './locate'
import type { Bounds, Station } from './network'
import { toGround } from './projection'

const TIMES_SQ = { lat: 40.758, lon: -73.9855 }
const BAYSIDE = { lat: 40.7685, lon: -73.7771 }
const BOSTON = { lat: 42.3601, lon: -71.0589 }

function station(id: string, name: string, lat: number, lon: number): Station {
  return { id, name, pos: toGround({ lat, lon }), routeIds: [], stops: [], access: { status: 'none' }, leadId: id }
}

const stations = [
  station('127', 'Times Sq-42 St', 40.7553, -73.9872),
  station('R20', '14 St-Union Sq', 40.7347, -73.9906),
  station('G08', 'Jamaica Center', 40.7022, -73.8011),
]
const groupsOf = (list: readonly Station[]) => new Map(list.map((s) => [s.id, { ...s, memberIds: [s.id], otherNames: [] }]))
const groups = groupsOf(stations)
const bounds: Bounds = { minX: -9000, maxX: 20000, minZ: -20000, maxZ: 9000 }

describe('toFix', () => {
  it('accepts a valid fix', () => {
    expect(toFix(40.7, -74, 20)).toEqual({ lat: 40.7, lon: -74, accuracyM: 20 })
  })

  it('rejects NaN, infinities, out-of-range coordinates and a negative accuracy', () => {
    expect(toFix(NaN, -74, 20)).toBeNull()
    expect(toFix(40.7, Infinity, 20)).toBeNull()
    expect(toFix(40.7, -74, NaN)).toBeNull()
    expect(toFix(91, -74, 20)).toBeNull()
    expect(toFix(40.7, 181, 20)).toBeNull()
    expect(toFix(40.7, -74, -1)).toBeNull()
  })
})

describe('placeFix', () => {
  it('lifts the nearest member of a complex to its group, with the distance to the member', () => {
    const lead = station('A27', 'Times Sq-42 St', 40.7553, -73.9872)
    const member = { ...station('R16', '42 St-Port Authority', 40.7573, -73.9897), leadId: 'A27' }
    const group = { ...lead, memberIds: ['A27', 'R16'], otherNames: ['42 St-Port Authority'] }
    const p = placeFix({ lat: 40.7574, lon: -73.9897, accuracyM: 10 }, [lead, member], new Map([['A27', group], ['R16', group]]), bounds)
    expect(p?.nearest).toMatchObject({ id: 'A27', name: 'Times Sq-42 St', pos: lead.pos })
    expect(p?.nearest.distanceM).toBeLessThan(20)
  })

  it('puts a fix at Times Square near its station, projected through toGround', () => {
    const p = placeFix({ ...TIMES_SQ, accuracyM: 20 }, stations, groups, bounds)
    expect(p?.kind).toBe('near')
    if (p?.kind !== 'near') return
    expect(p.ground).toEqual(toGround(TIMES_SQ))
    expect(p.nearest.id).toBe('127')
    expect(p.nearest.distanceM).toBeGreaterThan(200)
    expect(p.nearest.distanceM).toBeLessThan(500)
  })

  it('marks a fix inside the network but far from any station as far', () => {
    const p = placeFix({ ...BAYSIDE, accuracyM: 20 }, stations, groups, bounds)
    expect(p?.kind).toBe('far')
    expect(p?.nearest.id).toBe('G08')
  })

  it('frames a far fix together with its nearest station', () => {
    const p = placeFix({ ...BAYSIDE, accuracyM: 20 }, stations, groups, bounds)
    if (p?.kind !== 'far') throw new Error('expected far')
    const station = stations.find((s) => s.id === 'G08')!
    expect(p.viewCenter.x).toBeCloseTo((p.ground.x + station.pos.x) / 2)
    expect(p.viewCenter.z).toBeCloseTo((p.ground.z + station.pos.z) / 2)
    expect(p.viewRadiusM).toBeCloseTo((p.nearest.distanceM / 2 + 20) * FAR_VIEW_PADDING)
  })

  it('frames a near fix on itself', () => {
    const p = placeFix({ ...TIMES_SQ, accuracyM: 20 }, stations, groups, bounds)
    if (p?.kind !== 'near') throw new Error('expected near')
    expect(p.viewCenter).toEqual(p.ground)
  })

  it('puts a fix far outside the network as outside, with the nearest station', () => {
    const p = placeFix({ ...BOSTON, accuracyM: 20 }, stations, groups, bounds)
    expect(p?.kind).toBe('outside')
    expect(p).not.toHaveProperty('ground')
    expect(p?.nearest.id).toBe('G08')
  })

  it('has no placement for an empty network', () => {
    expect(placeFix({ ...TIMES_SQ, accuracyM: 20 }, [], groups, bounds)).toBeNull()
  })

  it('flips approximate just above the threshold', () => {
    const at = placeFix({ ...TIMES_SQ, accuracyM: APPROXIMATE_M }, stations, groups, bounds)
    const over = placeFix({ ...TIMES_SQ, accuracyM: APPROXIMATE_M + 1 }, stations, groups, bounds)
    expect(at?.kind === 'near' && at.approximate).toBe(false)
    expect(over?.kind === 'near' && over.approximate).toBe(true)
  })

  it('frames at least the floor radius, grows with accuracy, and caps the station contribution', () => {
    const lone = [station('127', 'Times Sq-42 St', 40.7553, -73.9872)]
    const radius = (lat: number, accuracyM: number) => {
      const p = placeFix({ lat, lon: -73.9872, accuracyM }, lone, groupsOf(lone), bounds)
      return p?.kind === 'near' ? p.viewRadiusM : NaN
    }
    // Standing on the station with a small accuracy: the floor.
    expect(radius(40.7553, 5)).toBe(MIN_VIEW_RADIUS_M)
    // Accuracy wider than everything else.
    expect(radius(40.7553, 1200)).toBe(1200)
    // About 1.5 km from the station: the station only widens the view up to its cap.
    expect(radius(40.7553 + 0.0135, 10)).toBe(NEAREST_IN_VIEW_CAP_M)
    // About 500 m away: the station distance itself.
    const mid = radius(40.7553 + 0.0045, 10)
    expect(mid).toBeGreaterThan(MIN_VIEW_RADIUS_M)
    expect(mid).toBeLessThan(NEAREST_IN_VIEW_CAP_M)
  })
})

describe('failureFromCode', () => {
  it('maps the geolocation error codes', () => {
    expect(failureFromCode(1)).toBe('denied')
    expect(failureFromCode(2)).toBe('unavailable')
    expect(failureFromCode(3)).toBe('timeout')
    expect(failureFromCode(99)).toBe('unavailable')
  })
})

describe('locate state transitions', () => {
  const near = placeFix({ ...TIMES_SQ, accuracyM: 20 }, stations, groups, bounds) as Placement
  const outside = placeFix({ ...BOSTON, accuracyM: 20 }, stations, groups, bounds) as Placement
  const located: LocateState = { status: 'located', placement: near }

  it('keeps the last good placement while re-locating and after a failure', () => {
    const locating = startLocating(located)
    expect(lastPlacement(locating)).toBe(near)
    const failed = failLocating(locating, 'timeout')
    expect(failed).toEqual({ status: 'failed', reason: 'timeout', previous: near })
    expect(lastPlacement(failed)).toBe(near)
  })

  it('has nothing to keep on a first failure', () => {
    expect(lastPlacement(failLocating(startLocating({ status: 'idle' }), 'denied'))).toBeNull()
  })

  it('dismisses: clears a shown fix, cancels a pending request, keeps the last good fix on a failure', () => {
    expect(dismissLocate(located)).toEqual({ status: 'idle' })
    expect(dismissLocate(startLocating({ status: 'idle' }))).toEqual({ status: 'idle' })
    expect(dismissLocate(startLocating(located))).toEqual(located)
    expect(dismissLocate(failLocating(located, 'unavailable'))).toEqual(located)
  })

  it('draws no marker for an outside placement', () => {
    expect(markedPlacement({ status: 'located', placement: outside })).toBeNull()
    expect(markedPlacement(located)).toBe(near)
  })
})
