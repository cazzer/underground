import { describe, expect, it } from 'vitest'
import { lookup } from '../realtime/fixture'
import { D, NOW, overlayScheduled, rtTrip, snapshotOf } from './overlayFixture'
import { overlayRealtime, type OverlayInput } from './overlay'
import { route } from './raptor'
import type { Pattern, Timetable } from './types'

const GENERATED_AT = NOW - 4
const NOW_DAY = NOW - D // 77754

const scheduled = overlayScheduled()

const t1 = rtTrip('129600_1..N03R', '1', [['101N', 77880 + 0], ['102N', 78000], ['103N', 78150]])
const t2 = rtTrip('130000_1..N', '1', [['102N', 78060], ['103N', 78180], ['104N', 78330]], { assigned: false })
const t3 = rtTrip('127000_1..N', '1', [['101N', 78600], ['102N', 78720], ['103N', 78870]])
const t4 = rtTrip('145000_1..N', '1', [['101N', 87060], ['102N', 87180]])
const t5 = rtTrip('128750_W..N', 'W', [['101N', 77800], ['103N', 78100]])
const t6 = rtTrip('126000_1..N', '1', [['101N', 78300], ['102N', 78420]], { timestamp: NOW - 2000 })

function input(trips: Parameters<typeof snapshotOf>[0], opts: { stale?: Parameters<typeof snapshotOf>[1]['stale']; generatedAt?: number; nowS?: number } = {}): OverlayInput {
  const generatedAt = opts.generatedAt ?? GENERATED_AT
  return { snapshot: snapshotOf(trips, { generatedAt, stale: opts.stale }), nowS: opts.nowS ?? NOW, day: '20261120', lookup }
}

const patternOf = (tt: Timetable, key: string): Pattern => tt.patterns.find((p) => p.key === key)!
const idsOf = (tt: Timetable, key: string): string[] => [...patternOf(tt, key).tripIds]
const liveOf = (tt: Timetable, key: string): number[] => [...patternOf(tt, key).live]
const row = (p: Pattern, id: string): number[] => {
  const n = p.stops.length
  const i = p.tripIds.indexOf(id)
  return [...p.arr.subarray(i * n, (i + 1) * n)]
}

const full = overlayRealtime(scheduled, input({ '1234567': [t1, t2, t3, t4, t6], nqrw: [t5] }, { stale: ['si'] }))
const out = full.timetable

describe('overlayRealtime', () => {
  it('replaces a matched trip with its realtime twin', () => {
    const p = patternOf(out, 'one-n')
    expect(p.tripIds).toContain('1234567:129600_1..N03R')
    expect(p.tripIds).not.toContain('1-2136')
    const id = '1234567:129600_1..N03R'
    expect(row(p, id)).toEqual([77880, 78000, 78150])
    expect([...p.dep.subarray(p.tripIds.indexOf(id) * 3, p.tripIds.indexOf(id) * 3 + 3)]).toEqual([77880, 78000, 78150])
    expect(p.live[p.tripIds.indexOf(id)]).toBe(1)
  })

  it('picks the pattern that contains the run when a key collides', () => {
    expect(idsOf(out, 'one-n05')).toEqual(['1234567:130000_1..N'])
    expect(row(patternOf(out, 'one-n05'), '1234567:130000_1..N')).toEqual([78060, 78180, 78330])
    // 1-2140 shares the key but not the run: no twin, so it is cancelled by the window.
    expect(idsOf(out, 'one-n')).not.toContain('1-2140')
  })

  it('cancels scheduled trips in the window that the feed lacks, and keeps the rest', () => {
    const ids = idsOf(out, 'w-n')
    expect(ids).not.toContain('W-2133')
    expect(ids).toEqual(expect.arrayContaining(['W-2100', 'W-2230']))
    expect(liveOf(out, 'w-n')).toEqual([0, 0])
    expect(idsOf(out, 'one-n')).toContain('1-2300')
  })

  it('adds a trip with no twin with its predicted times', () => {
    const id = '1234567:127000_1..N'
    const p = patternOf(out, 'one-n')
    expect(row(p, id)).toEqual([78600, 78720, 78870])
    expect(p.live[p.tripIds.indexOf(id)]).toBe(1)
    expect(full.counts.onHost).toBe(1)
  })

  it('continues past the last prediction on the twin schedule', () => {
    const id = '1234567:145000_1..N'
    const p = patternOf(out, 'one-n')
    expect(row(p, id)).toEqual([87060, 87180, 87330])
    expect(p.tripIds).not.toContain('1-2410')
    expect(full.counts.extended).toBe(1)
  })

  it('gives a reroute its own pattern', () => {
    const p = patternOf(out, 'rt:101N 103N')
    expect(p.tripIds).toEqual(['nqrw:128750_W..N'])
    expect(p.routeIds).toEqual(['W'])
    expect(p.live[0]).toBe(1)
    expect(idsOf(out, 'w-n')).not.toContain('W-2127')
    expect(full.counts.oneOff).toBe(1)
  })

  it('counts what it did', () => {
    expect(full.counts).toMatchObject({
      liveFeeds: ['1234567', 'ace', 'bdfm', 'g', 'jz', 'nqrw', 'l'],
      scheduleFeeds: ['si'],
      onTwin: 3,
      onHost: 1,
      oneOff: 1,
      replaced: 4,
      cancelled: 2,
      extended: 1,
      offFeed: 0,
      skipped: { ghost: 1, noKnownStop: 0, tooShort: 0 },
    })
  })

  it('keeps the schedule of a stale feed', () => {
    expect(patternOf(out, 'si-s')).toBe(patternOf(scheduled, 'si-s'))
    expect(idsOf(out, 'si-s')).toEqual(['SI-2146'])
    expect(liveOf(out, 'si-s')).toEqual([0])
    expect(full.counts.scheduleFeeds).toContain('si')

    const stale = overlayRealtime(scheduled, input({ nqrw: [t5] }, { stale: ['1234567'] })).timetable
    for (const p of scheduled.patterns.filter((q) => q.routeIds[0] === '1')) expect(patternOf(stale, p.key)).toBe(p)
  })

  it('returns the schedule itself when the snapshot is older than two minutes', () => {
    const old = overlayRealtime(scheduled, input({ '1234567': [t1] }, { nowS: GENERATED_AT + 121 }))
    expect(old.timetable).toBe(scheduled)
    expect(old.counts.liveFeeds).toEqual([])
    expect(old.counts.scheduleFeeds).toHaveLength(8)
  })

  it('returns the schedule itself when every feed is stale', () => {
    const all = ['1234567', 'ace', 'bdfm', 'g', 'jz', 'nqrw', 'l', 'si'] as const
    expect(overlayRealtime(scheduled, input({}, { stale: all })).timetable).toBe(scheduled)
  })

  it('skips ghosts but not unassigned trips', () => {
    expect(full.counts.skipped.ghost).toBe(1)
    expect(idsOf(out, 'one-n')).not.toContain('1234567:126000_1..N')
    expect(idsOf(out, 'one-n05')).toContain('1234567:130000_1..N')
  })

  it('refuses to overlay an overlay', () => {
    expect(() => overlayRealtime(out, input({ '1234567': [t1] }))).toThrow(/scheduled timetable/)
  })

  it('leaves a trip with one known stop to nothing and drops one with none', () => {
    const lone = rtTrip('100000_X..N', 'X', [['101N', 78900]])
    const unknown = rtTrip('100001_X..N', 'X', [['999N', 78900]])
    const r = overlayRealtime(scheduled, input({ '1234567': [lone, unknown] }))
    expect(r.counts.skipped).toEqual({ ghost: 0, noKnownStop: 1, tooShort: 1 })
    expect(r.timetable.patterns.some((p) => p.key.startsWith('rt:'))).toBe(false)
  })

  it('never lets a trip id collide with a loader id', () => {
    expect(out.patterns.flatMap((p) => p.tripIds).filter((id) => id.startsWith('1234567:'))).toHaveLength(4)
  })
})

describe('routing over the overlay', () => {
  it('rides the rerouted trip and reports it live', () => {
    const js = route(out, ['101'], ['103'], NOW_DAY)
    expect(js).toHaveLength(1)
    expect(js[0]!.legs).toEqual([
      {
        kind: 'ride',
        routeId: 'W',
        tripId: 'nqrw:128750_W..N',
        patternKey: 'rt:101N 103N',
        boardStop: '101N',
        alightStop: '103N',
        stops: ['101N', '103N'],
        departS: 77800,
        arriveS: 78100,
        live: true,
      },
    ])
  })

  it('boards the matched live trip, where the schedule leaves earlier', () => {
    const js = route(out, ['101'], ['102'], NOW_DAY)
    expect(js).toHaveLength(1)
    expect(js[0]!.legs[0]).toMatchObject({ kind: 'ride', tripId: '1234567:129600_1..N03R', departS: 77880, live: true })

    const before = route(scheduled, ['101'], ['102'], NOW_DAY)
    expect(before[0]!.legs[0]).toMatchObject({ kind: 'ride', tripId: '1-2136', departS: 77760, live: false })
  })

  it('reports a trip outside the window as scheduled', () => {
    const js = route(out, ['101'], ['103'], 82000)
    expect(js[0]!.legs[0]).toMatchObject({ kind: 'ride', tripId: '1-2300', departS: 82800, live: false })
  })
})
