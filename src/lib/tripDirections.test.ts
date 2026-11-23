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

/** X is in a complex with S and T. */
const siblingsOf = (id: string): readonly string[] => ({ X: ['S', 'T'], S: ['X', 'T'], T: ['X', 'S'] })[id] ?? []

const base: DirectionsInput = {
  end: 'to',
  target: { stationId: 'X', place: null },
  current: { from: null, to: null },
  currentPlaces: { from: null, to: null },
  focusedId: null,
  siblingsOf,
  fix: null,
  fixStation: null,
}
const run = (over: Partial<DirectionsInput>) => directionsTrip({ ...base, ...over })

describe('directionsTrip', () => {
  it('fills From from the marked fix before the focused station', () => {
    const t = run({ fix: fixAt('L08'), focusedId: '635' })
    expect(t).toEqual({ ends: { from: 'L08', to: 'X' }, places: { from: null, to: null }, empty: null, fixStation: 'L08' })
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
    expect(run({ focusedId: 'S' }).empty).toBe('from')
  })

  it('never pairs the target with its own complex, from any source', () => {
    expect(run({ fix: fixAt('S') }).empty).toBe('from')
    expect(run({ current: { from: 'T', to: null } }).empty).toBe('from')
    expect(run({ end: 'from', current: { from: null, to: 'S' } }).empty).toBe('to')
    expect(run({ current: { from: 'S', to: 'T' }, focusedId: 'S', fix: fixAt('T') }).empty).toBe('from')
  })

  it('leaves the other end empty when nothing fills it', () => {
    expect(run({}).empty).toBe('from')
    expect(run({ end: 'from' })).toEqual({ ends: { from: 'X', to: null }, places: { from: null, to: null }, empty: 'to', fixStation: null })
  })

  it('keeps the earlier other end, and its note', () => {
    const t = run({ current: { from: 'A', to: 'B' }, currentPlaces: { from: '120 Broadway', to: null } })
    expect(t).toEqual({ ends: { from: 'A', to: 'X' }, places: { from: '120 Broadway', to: null }, empty: null, fixStation: null })
  })

  it('keeps an earlier end over the fix and the focused station', () => {
    expect(run({ current: { from: 'A', to: 'B' }, focusedId: 'C', fix: fixAt('L08') }).ends).toEqual({ from: 'A', to: 'X' })
    expect(run({ target: { stationId: 'D', place: null }, current: { from: 'A', to: 'B' }, focusedId: 'C' }).ends).toEqual({ from: 'A', to: 'D' })
  })

  it('goes the way back: directions from the old To', () => {
    const t = run({ end: 'from', target: { stationId: 'B', place: null }, current: { from: 'A', to: 'B' }, currentPlaces: { from: 'Home', to: 'Work' } })
    expect(t).toEqual({ ends: { from: 'B', to: 'A' }, places: { from: null, to: 'Home' }, empty: null, fixStation: null })
  })

  it('directions to the old From swaps likewise', () => {
    const t = run({ target: { stationId: 'A', place: null }, current: { from: 'A', to: 'B' } })
    expect(t.ends).toEqual({ from: 'B', to: 'A' })
  })

  it('uses the focused station when the earlier ends are gone, before the way back', () => {
    expect(run({ target: { stationId: 'B', place: null }, end: 'from', current: { from: 'A', to: 'B' }, focusedId: 'F' }).ends).toEqual({ from: 'B', to: 'F' })
  })

  it('sets the target place note, and a station pick clears the end note', () => {
    expect(run({ target: { stationId: 'X', place: '120 Broadway' }, focusedId: 'F' }).places).toEqual({ from: null, to: '120 Broadway' })
    expect(run({ current: { from: 'A', to: 'X' }, currentPlaces: { from: null, to: 'Old place' } }).places.to).toBeNull()
  })

  it('flags the end station the fix filled, only when the fix candidate wins', () => {
    expect(run({ fix: fixAt('L08') }).fixStation).toBe('L08')
    // The focused station, an earlier end or the target itself were the visitor's.
    expect(run({ fix: fixAt('X'), focusedId: '635' }).fixStation).toBeNull()
    expect(run({ current: { from: 'A', to: 'B' }, fix: fixAt('L08') }).fixStation).toBeNull()
    expect(run({ end: 'from', fix: fixAt('L08'), focusedId: '635' }).fixStation).toBeNull()
  })

  it('keeps the flag on an earlier end the fix filled, wherever it lands', () => {
    // Directions to D on L08 (from the fix) to B: From stays L08, still never chosen.
    const kept = run({ target: { stationId: 'D', place: null }, current: { from: 'L08', to: 'B' }, fixStation: 'L08' })
    expect(kept).toMatchObject({ ends: { from: 'L08', to: 'D' }, fixStation: 'L08' })
    // The way back from B moves it to To.
    const back = run({ end: 'from', target: { stationId: 'B', place: null }, current: { from: 'L08', to: 'B' }, fixStation: 'L08' })
    expect(back).toMatchObject({ ends: { from: 'B', to: 'L08' }, fixStation: 'L08' })
    // Picking it as the target is choosing it.
    expect(run({ end: 'from', target: { stationId: 'L08', place: null }, current: { from: 'L08', to: 'B' }, fixStation: 'L08' }).fixStation).toBeNull()
  })

  it('never makes the two ends one station or one complex, and flags exactly the unset end', () => {
    const ids = [null, 'A', 'B', 'X', 'S']
    for (const end of ['from', 'to'] as const)
      for (const from of ids)
        for (const to of ids)
          for (const focusedId of ids)
            for (const fix of [null, fixAt('A'), fixAt('X'), fixAt('S')]) {
              const t = run({ end, current: { from, to }, focusedId, fix })
              const other = t.ends[end === 'from' ? 'to' : 'from']
              expect(other === null || (other !== 'X' && other !== 'S')).toBe(true)
              expect(t.empty).toBe(other === null ? (end === 'from' ? 'to' : 'from') : null)
              expect(t.ends[end]).toBe('X')
            }
  })
})
