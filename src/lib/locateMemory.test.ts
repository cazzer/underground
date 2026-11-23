import { beforeEach, describe, expect, it } from 'vitest'
import { excludedByLocate, forgetLocate, locateMemoryFor, rememberLocate, rememberUnviewedFix, type LocateMemory } from './locateMemory'
import { toGround, type Ground } from './projection'

const HERE = toGround({ lat: 40.7347, lon: -73.9906 })
const east = (g: Ground, m: number): Ground => ({ x: g.x + m, z: g.z })
const memory = (nearestId = 'A', center = HERE): LocateMemory => ({ center, radiusM: 250, nearestId })

describe('an unviewed fix (found in the search dialog, no flight)', () => {
  beforeEach(forgetLocate)

  it('survives a view that never came near it, and still excludes its nearest station', () => {
    rememberUnviewedFix(memory('A'))
    const far = east(HERE, 12000)
    expect(locateMemoryFor(far)?.nearestId).toBe('A')
    expect(locateMemoryFor(east(HERE, 30000))?.nearestId).toBe('A')
    expect(excludedByLocate(locateMemoryFor(far), far, null)).toBe(false)
    expect(excludedByLocate(locateMemoryFor(far), far, 'A')).toBe(true)
  })

  it('is forgotten once the view has come within the guard and then left', () => {
    rememberUnviewedFix(memory())
    expect(locateMemoryFor(east(HERE, 500))).not.toBeNull()
    expect(locateMemoryFor(east(HERE, 5000))).toBeNull()
    expect(locateMemoryFor(HERE)).toBeNull()
  })

  it('holds with no camera target', () => {
    rememberUnviewedFix(memory())
    expect(locateMemoryFor(null)).not.toBeNull()
  })
})

describe('the memory slot', () => {
  beforeEach(forgetLocate)

  it('a flight replaces an unviewed fix and is armed at once', () => {
    rememberUnviewedFix(memory('A'))
    rememberLocate(memory('B'))
    expect(locateMemoryFor(east(HERE, 5000))).toBeNull()
  })

  it('an unviewed fix replaces a flight', () => {
    rememberLocate(memory('A', east(HERE, 20000)))
    rememberUnviewedFix(memory('B'))
    expect(locateMemoryFor(east(HERE, 9000))?.nearestId).toBe('B')
  })

  it('forgetLocate clears either', () => {
    rememberUnviewedFix(memory())
    forgetLocate()
    expect(locateMemoryFor(HERE)).toBeNull()
    rememberLocate(memory())
    forgetLocate()
    expect(locateMemoryFor(HERE)).toBeNull()
  })
})
