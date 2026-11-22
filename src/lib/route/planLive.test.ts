import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookup } from '../realtime/fixture'
import { D, NOW, overlayScheduled, rtTrip, snapshotOf } from './overlayFixture'
import * as overlayModule from './overlay'
import type { RouterTimetable } from './plan'
import { planOnLive } from './planLive'

vi.mock('./overlay', async (importActual) => {
  const actual = await importActual<typeof import('./overlay')>()
  return { ...actual, overlayRealtime: vi.fn(actual.overlayRealtime) }
})

const rt = (): RouterTimetable => ({ timetable: overlayScheduled(), window: { date: '20261120', startS: D, frames: [] } })
const t1 = rtTrip('129600_1..N03R', '1', [['101N', 77880], ['102N', 78000], ['103N', 78150]])
const snapshot = () => snapshotOf({ '1234567': [t1] }, { generatedAt: NOW - 4 })
const overlay = vi.mocked(overlayModule.overlayRealtime)
const real = overlay.getMockImplementation()!

describe('planOnLive', () => {
  beforeEach(() => {
    overlay.mockClear()
  })
  afterEach(() => {
    overlay.mockImplementation(real)
  })

  it('plans on the schedule with no live data', () => {
    const { journeys, overlay: counts } = planOnLive(rt(), ['101'], ['103'], NOW, null)
    expect(counts).toBeNull()
    expect(overlay).not.toHaveBeenCalled()
    expect(journeys.length).toBeGreaterThan(0)
    expect(journeys.flatMap((j) => j.legs).every((l) => l.kind !== 'ride' || !l.live)).toBe(true)
  })

  it('rides a live train and reports what the overlay did', () => {
    const { journeys, overlay: counts } = planOnLive(rt(), ['101'], ['103'], NOW, { snapshot: snapshot(), lookup })
    expect(counts?.liveFeeds).toContain('1234567')
    const rides = journeys.flatMap((j) => j.legs).filter((l) => l.kind === 'ride')
    expect(rides.some((l) => l.live && l.tripId === '1234567:129600_1..N03R')).toBe(true)
  })

  it('overlays once per timetable and snapshot', () => {
    const table = rt()
    const live = { snapshot: snapshot(), lookup }
    planOnLive(table, ['101'], ['103'], NOW, live)
    planOnLive(table, ['101'], ['104'], NOW + 30, live)
    expect(overlay).toHaveBeenCalledTimes(1)
    planOnLive(table, ['101'], ['103'], NOW + 30, { snapshot: snapshot(), lookup })
    expect(overlay).toHaveBeenCalledTimes(2)
    planOnLive(rt(), ['101'], ['103'], NOW, live)
    expect(overlay).toHaveBeenCalledTimes(3)
  })

  it('does not let a snapshot too old to use stand in for a fresh answer', () => {
    const table = rt()
    const live = { snapshot: snapshot(), lookup }
    const old = planOnLive(table, ['101'], ['103'], NOW + 600, live)
    expect(old.overlay?.liveFeeds).toEqual([])
    const fresh = planOnLive(table, ['101'], ['103'], NOW, live)
    expect(fresh.overlay?.liveFeeds.length).toBeGreaterThan(0)
  })

  it('falls back to the schedule when the overlay throws, logging once per snapshot', () => {
    overlay.mockImplementation(() => {
      throw new Error('boom')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const table = rt()
    const live = { snapshot: snapshot(), lookup }
    const first = planOnLive(table, ['101'], ['103'], NOW, live)
    const second = planOnLive(table, ['101'], ['103'], NOW + 30, live)
    expect(first.overlay).toBeNull()
    expect(second.overlay).toBeNull()
    expect(first.journeys.length).toBeGreaterThan(0)
    expect(first.journeys.flatMap((j) => j.legs).every((l) => l.kind !== 'ride' || !l.live)).toBe(true)
    expect(error).toHaveBeenCalledTimes(1)
    expect(overlay).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
