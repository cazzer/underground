import { describe, expect, it } from 'vitest'
import { buildTimetable, makePatterns } from './patterns'
import { groupPatterns, oneOffGroup, rebuildPatterns } from './overlayGroups'
import { buildStopIndex } from './stops'

const index = buildStopIndex({ stopIds: ['101N', '102N', '103N'], changeS: new Map(), transfers: [] })
const stops = ['101N', '102N', '103N']
const trip = (id: string, ...t: number[]) => ({ id, routeId: '1', arr: t, dep: t })

// Loader keys are "<date>:<service>/<file index>" and a lane adds "#j": the fast trip overtakes the slow one.
const lanes = makePatterns(index, {
  key: '20261120:Weekday/3',
  stops,
  trips: [trip('20261120:Weekday/3/0', 0, 100, 200), trip('20261120:Weekday/3/1', 10, 60, 120)],
})
const other = makePatterns(index, { key: '20261120:Weekday/4', stops, trips: [trip('20261120:Weekday/4/0', 500, 600, 700)] })
const tt = buildTimetable(index, [...lanes, ...other])

describe('groupPatterns', () => {
  it('merges the lanes of one key and nothing else', () => {
    expect(lanes.map((p) => p.key)).toEqual(['20261120:Weekday/3', '20261120:Weekday/3#1'])
    const groups = groupPatterns(tt)
    expect([...groups.keys()]).toEqual(['20261120:Weekday/3', '20261120:Weekday/4'])
    const g = groups.get('20261120:Weekday/3')!
    expect(g.rows.map((r) => r.id)).toEqual(['20261120:Weekday/3/0', '20261120:Weekday/3/1'])
    expect(g.direction).toBe('N')
    expect(g.lanes).toHaveLength(2)
  })

  it('throws on lanes with different stops, and on an overlaid timetable', () => {
    const odd = makePatterns(index, { key: '20261120:Weekday/3#9', stops: ['101N', '103N'], trips: [trip('x', 0, 100)] })
    expect(() => groupPatterns(buildTimetable(index, [...lanes, ...odd]))).toThrow(/different stops/)
    const live = makePatterns(index, { key: 'k', stops, trips: [{ ...trip('y', 0, 1, 2), live: true }] })
    expect(() => groupPatterns(buildTimetable(index, live))).toThrow(/scheduled timetable/)
    const rt = makePatterns(index, { key: 'rt:101N 102N', stops: ['101N', '102N'], trips: [trip('z', 0, 1)] })
    expect(() => groupPatterns(buildTimetable(index, rt))).toThrow(/scheduled timetable/)
  })
})

describe('rebuildPatterns', () => {
  it('reuses unchanged lanes, rebuilds changed ones and puts reroutes last by key', () => {
    const groups = groupPatterns(tt)
    const g = groups.get('20261120:Weekday/3')!
    g.rows[1]!.removed = true
    g.changed = true
    const b = oneOffGroup(index, ['101N', '103N'])
    const a = oneOffGroup(index, ['101N', '102N'])
    for (const o of [b, a]) {
      o.added.push({ ...trip(`t${o.key}`, 0, 50), live: true })
      o.changed = true
      groups.set(o.key, o)
    }
    const out = rebuildPatterns(index, groups)
    expect(out.map((p) => p.key)).toEqual(['20261120:Weekday/3', '20261120:Weekday/4', 'rt:101N 102N', 'rt:101N 103N'])
    expect(out[0]!.tripIds).toEqual(['20261120:Weekday/3/0'])
    expect(out[1]).toBe(other[0])
    expect(out[2]!.live[0]).toBe(1)
  })
})
