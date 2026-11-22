import { describe, expect, it } from 'vitest'
import { createBandView } from '../bandOffset'
import type { LiveTrip } from '../realtime/prepareTrips'
import { geometries } from '../realtime/fixture'
import { ANCHOR_CUT_M, createFollowAnchor, writeFollowAnchor } from './followAnchor'
import { createSlotTable } from './slots'
import { createTrackPoint, trackPointInto } from './trackPoint'

const view = createBandView()
const north = geometries.get('1..N03R')!
const other = geometries.get('1..N05R')!

function table() {
  const t = createSlotTable(4)
  t.keys[1] = 'a'
  t.trips[1] = { key: 'a', geometry: north } as unknown as LiveTrip
  t.byKey.set('a', 1)
  t.drawGeometry[1] = north
  t.displayed[1] = 500
  t.high = 2
  return t
}

describe('writeFollowAnchor', () => {
  it('is the drawn point at the displayed distance, plus the carry offset', () => {
    const t = table()
    t.carry.x[1] = 3
    t.carry.y[1] = 0
    t.carry.z[1] = -4
    t.carry.at[1] = 10
    t.carry.dur[1] = 1
    const a = writeFollowAnchor(createFollowAnchor(), t, 1, view, 10, createTrackPoint())
    const p = trackPointInto(north, 500, view, createTrackPoint())
    expect(a.valid).toBe(true)
    expect(a.x).toBeCloseTo(p.x + 3, 9)
    expect(a.z).toBeCloseTo(p.z - 4, 9)
    // The carry eases out: gone after its duration.
    writeFollowAnchor(a, t, 1, view, 11, createTrackPoint())
    expect(a.x).toBeCloseTo(p.x, 9)
  })

  it('is invalid with no slot, no shape or no distance yet', () => {
    const t = table()
    const s = createTrackPoint()
    expect(writeFollowAnchor(createFollowAnchor(), t, -1, view, 0, s).valid).toBe(false)
    expect(writeFollowAnchor(createFollowAnchor(), t, 2, view, 0, s).valid).toBe(false)
    t.displayed[1] = NaN
    expect(writeFollowAnchor(createFollowAnchor(), t, 1, view, 0, s).valid).toBe(false)
  })

  it('marks a cut when it becomes valid, changes shape or jumps, and not for travel', () => {
    const t = table()
    const s = createTrackPoint()
    const a = createFollowAnchor()
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(true)
    t.displayed[1] = 520
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(false)
    t.displayed[1] = 520 + ANCHOR_CUT_M
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(true)
    t.drawGeometry[1] = other
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(true)
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(false)
    writeFollowAnchor(a, t, -1, view, 0, s)
    expect(writeFollowAnchor(a, t, 1, view, 0, s).cut).toBe(true)
  })
})
