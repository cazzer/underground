import { beforeEach, describe, expect, it } from 'vitest'
import { excludedByLocate, forgetLocate, locateMemoryFor, rememberLocate, rememberUnviewedFix, type LocateMemory } from './locateMemory'
import { toGround, type Ground } from './projection'

const HERE = toGround({ lat: 40.7347, lon: -73.9906 })
const east = (g: Ground, m: number): Ground => ({ x: g.x + m, z: g.z })
const memory = (nearestId = 'A', center = HERE): LocateMemory => ({ center, radiusM: 250, nearestId })
const ids = (view: Ground | null) => locateMemoryFor(view).map((m) => m.nearestId)

describe('an unviewed fix (found in the search dialog, no flight)', () => {
  beforeEach(forgetLocate)

  it('survives a view that never came near it, and still excludes its nearest station', () => {
    rememberUnviewedFix(memory('A'))
    const far = east(HERE, 12000)
    expect(ids(far)).toEqual(['A'])
    expect(ids(east(HERE, 30000))).toEqual(['A'])
    expect(excludedByLocate(locateMemoryFor(far), far, null)).toBe(false)
    expect(excludedByLocate(locateMemoryFor(far), far, 'A')).toBe(true)
  })

  it('is forgotten once the view has come within the guard and then left', () => {
    rememberUnviewedFix(memory())
    expect(ids(east(HERE, 500))).toEqual(['A'])
    expect(ids(east(HERE, 5000))).toEqual([])
    expect(ids(HERE)).toEqual([])
  })

  it('holds with no camera target', () => {
    rememberUnviewedFix(memory())
    expect(ids(null)).toEqual(['A'])
  })
})

describe('the two memory slots', () => {
  beforeEach(forgetLocate)

  it('a flight is armed at once and forgotten when the view leaves', () => {
    rememberLocate(memory('B'))
    expect(ids(east(HERE, 5000))).toEqual([])
  })

  it('a fix found later does not replace the flight: both hold while the view stays at the flight', () => {
    const elsewhere = east(HERE, 20000)
    rememberLocate(memory('A'))
    rememberUnviewedFix(memory('B', elsewhere))
    expect(ids(HERE).sort()).toEqual(['A', 'B'])
    expect(excludedByLocate(locateMemoryFor(HERE), HERE, 'B')).toBe(true)
    expect(excludedByLocate(locateMemoryFor(HERE), HERE, null)).toBe(true)
  })

  it('a later flight does not replace a fix never visited', () => {
    const elsewhere = east(HERE, 20000)
    rememberUnviewedFix(memory('B', elsewhere))
    rememberLocate(memory('C'))
    expect(ids(HERE).sort()).toEqual(['B', 'C'])
    expect(excludedByLocate(locateMemoryFor(HERE), east(HERE, 9000), 'B')).toBe(true)
  })

  it('a second unviewed fix does not replace an unforgotten first', () => {
    const second = east(HERE, 20000)
    rememberUnviewedFix(memory('B1', HERE))
    rememberUnviewedFix(memory('B2', second))
    // The view stayed at the first one while the user travelled.
    expect(ids(HERE).sort()).toEqual(['B1', 'B2'])
    expect(excludedByLocate(locateMemoryFor(HERE), HERE, null)).toBe(true)
    // Leaving the first forgets only the first; the second, never visited, holds.
    expect(ids(east(HERE, 9000))).toEqual(['B2'])
  })

  it('a press repeated on the spot takes the earlier entry\'s place; a different spot or station does not', () => {
    const far = east(HERE, 20000)
    rememberUnviewedFix(memory('B1', HERE))
    rememberUnviewedFix(memory('B2', far))
    rememberUnviewedFix(memory('B1', east(HERE, 30)))
    expect(ids(null).sort()).toEqual(['B1', 'B2'])
    rememberUnviewedFix(memory('B3', east(HERE, 30)))
    expect(ids(null).sort()).toEqual(['B1', 'B2', 'B3'])
  })

  it('a new circle that does not cover an earlier fix is added beside it', () => {
    rememberUnviewedFix(memory('B1', HERE))
    rememberUnviewedFix({ center: east(HERE, 8000), radiusM: 3000, nearestId: 'B1' })
    expect(locateMemoryFor(null)).toHaveLength(2)
  })

  it('keeps every distinct unviewed fix: no cap drops the oldest', () => {
    for (let i = 0; i < 12; i++) rememberUnviewedFix(memory(`F${i}`, east(HERE, i * 10000)))
    expect(ids(null)).toHaveLength(12)
  })

  it('an armed entry is not replaced by a new find on top of it', () => {
    rememberUnviewedFix(memory('B1', HERE))
    expect(ids(HERE)).toEqual(['B1'])
    rememberUnviewedFix(memory('B2', east(HERE, 100)))
    expect(ids(HERE).sort()).toEqual(['B1', 'B2'])
  })

  it('each slot is forgotten by its own rule', () => {
    const elsewhere = east(HERE, 20000)
    rememberLocate(memory('A'))
    rememberUnviewedFix(memory('B', elsewhere))
    // Leaving the flight forgets it; the unviewed fix, never visited, stays.
    expect(ids(east(HERE, 9000))).toEqual(['B'])
    // Visiting the unviewed fix and leaving forgets it too.
    expect(ids(elsewhere)).toEqual(['B'])
    expect(ids(east(elsewhere, 9000))).toEqual([])
  })

  it('forgetLocate clears both', () => {
    rememberUnviewedFix(memory())
    rememberLocate(memory('B'))
    forgetLocate()
    expect(ids(HERE)).toEqual([])
  })
})
