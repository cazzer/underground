import { describe, expect, it } from 'vitest'
import type { LocateState, NearestStation, Placement } from './locate'
import { formatDistance, locateMessage } from './locateMessage'

const ground = { x: 12345.678, z: -9876.543 }
const nearest: NearestStation = { id: 'G08', name: 'Jamaica Center', pos: { x: 1, z: 2 }, distanceM: 4200 }
const marked = { ground, accuracyM: 20, approximate: false, nearest, viewCenter: ground, viewRadiusM: 250 }

describe('formatDistance', () => {
  it('rounds to a tenth of a mile', () => {
    expect(formatDistance(4200)).toBe('about 2.6 mi')
    expect(formatDistance(1609.344)).toBe('about 1.0 mi')
  })

  it('says under 0.1 mi for a short distance', () => {
    expect(formatDistance(100)).toBe('under 0.1 mi')
  })
})

describe('locateMessage', () => {
  it('is null when idle', () => {
    expect(locateMessage({ status: 'idle' })).toBeNull()
  })

  it('has a distinct message for every failure', () => {
    const texts = (['denied', 'unavailable', 'timeout', 'unsupported'] as const).map(
      (reason) => locateMessage({ status: 'failed', reason, previous: null })?.text,
    )
    expect(new Set(texts).size).toBe(4)
    expect(texts.every((t) => t && t.length > 10)).toBe(true)
  })

  it('names the nearest station in the far and outside actions', () => {
    const far: Placement = { kind: 'far', ...marked }
    const outside: Placement = { kind: 'outside', nearest }
    for (const placement of [far, outside]) {
      const m = locateMessage({ status: 'located', placement })
      expect(m?.action).toEqual({ label: 'Go to Jamaica Center', stationId: 'G08' })
    }
    expect(locateMessage({ status: 'located', placement: far })?.text).toBe("You're about 2.6 mi from the nearest station.")
  })

  it('flags an approximate fix and offers no action when near', () => {
    const near = (approximate: boolean): LocateState => ({
      status: 'located',
      placement: { kind: 'near', ...marked, accuracyM: 500, approximate },
    })
    expect(locateMessage(near(false))?.text).toBe('Showing where you are.')
    const approx = locateMessage(near(true))
    expect(approx?.text).toContain('approximate')
    expect(approx?.text).toContain('about 0.3 mi')
    expect(approx?.action).toBeUndefined()
  })

  it('says so while locating, even when a previous fix is kept', () => {
    expect(locateMessage({ status: 'locating', previous: { kind: 'near', ...marked } })?.text).toBe('Finding your location…')
  })

  it('never puts coordinates in any text', () => {
    const states: LocateState[] = [
      { status: 'located', placement: { kind: 'far', ...marked } },
      { status: 'located', placement: { kind: 'near', ...marked } },
    ]
    for (const s of states) expect(locateMessage(s)?.text).not.toMatch(/12345|9876/)
  })
})
