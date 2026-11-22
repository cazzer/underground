import { describe, expect, it } from 'vitest'
import type { MarkedPlacement } from './locate'
import { directionsTrip, type DirectionsInput } from './tripDirections'

const fixAt = (id: string): MarkedPlacement =>
  ({
    kind: 'near',
    ground: { x: 0, z: 0 },
    accuracyM: 10,
    approximate: false,
    nearest: { id, name: id, pos: { x: 0, z: 0 }, distanceM: 100 },
    viewCenter: { x: 0, z: 0 },
    viewRadiusM: 300,
  }) as MarkedPlacement

const base: DirectionsInput = {
  end: 'to',
  target: { stationId: 'X', place: null },
  current: { from: null, to: null },
  currentPlaces: { from: null, to: null },
  focusedId: null,
  focusSiblings: [],
  fix: null,
}
const run = (over: Partial<DirectionsInput>) => directionsTrip({ ...base, ...over })

describe('directionsTrip', () => {
  it('fills From from the marked fix before the focused station', () => {
    const t = run({ fix: fixAt('L08'), focusedId: '635' })
    expect(t).toEqual({ ends: { from: 'L08', to: 'X' }, places: { from: null, to: null }, empty: null })
  })

  it('never fills To from the fix', () => {
    const t = run({ end: 'from', fix: fixAt('L08'), focusedId: '635' })
    expect(t.ends).toEqual({ from: 'X', to: '635' })
  })

  it('falls through a fix that is the target to the focused station', () => {
    expect(run({ fix: fixAt('X'), focusedId: '635' }).ends).toEqual({ from: '635', to: 'X' })
  })

  it('skips a focused station that is the target or shares its complex', () => {
    expect(run({ focusedId: 'X' }).empty).toBe('from')
    expect(run({ focusedId: 'R20', focusSiblings: ['X'] }).empty).toBe('from')
  })

  it('leaves the other end empty when nothing fills it', () => {
    expect(run({}).empty).toBe('from')
    expect(run({ end: 'from' })).toEqual({ ends: { from: 'X', to: null }, places: { from: null, to: null }, empty: 'to' })
  })

  it('keeps the earlier other end, and its note', () => {
    const t = run({ current: { from: 'A', to: 'B' }, currentPlaces: { from: '120 Broadway', to: null } })
    expect(t).toEqual({ ends: { from: 'A', to: 'X' }, places: { from: '120 Broadway', to: null }, empty: null })
  })

  it('goes the way back: directions from the old To', () => {
    const t = run({ end: 'from', target: { stationId: 'B', place: null }, current: { from: 'A', to: 'B' }, currentPlaces: { from: 'Home', to: 'Work' } })
    expect(t).toEqual({ ends: { from: 'B', to: 'A' }, places: { from: null, to: 'Home' }, empty: null })
  })

  it('directions to the old From swaps likewise', () => {
    const t = run({ target: { stationId: 'A', place: null }, current: { from: 'A', to: 'B' } })
    expect(t.ends).toEqual({ from: 'B', to: 'A' })
  })

  it('the focused station beats an earlier end', () => {
    expect(run({ focusedId: 'F', current: { from: 'A', to: 'B' } }).ends).toEqual({ from: 'F', to: 'X' })
  })

  it('sets the target place note, and a station pick clears the end note', () => {
    expect(run({ target: { stationId: 'X', place: '120 Broadway' }, focusedId: 'F' }).places).toEqual({ from: null, to: '120 Broadway' })
    expect(run({ current: { from: 'A', to: 'X' }, currentPlaces: { from: null, to: 'Old place' } }).places.to).toBeNull()
  })

  it('never makes the two ends one station, and flags exactly the unset end', () => {
    const ids = [null, 'A', 'B', 'X']
    for (const end of ['from', 'to'] as const)
      for (const from of ids)
        for (const to of ids)
          for (const focusedId of ids)
            for (const fix of [null, fixAt('A'), fixAt('X')]) {
              const t = run({ end, current: { from, to }, focusedId, fix })
              expect(t.ends.from === null || t.ends.from !== t.ends.to).toBe(true)
              const unset = t.ends.from === null ? 'from' : t.ends.to === null ? 'to' : null
              expect(t.empty).toBe(unset)
              expect(t.ends[end]).toBe('X')
            }
  })
})
