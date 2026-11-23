import { describe, expect, it, vi } from 'vitest'
import type { AlertEntity, ServiceAlert } from '../data/realtime'
import { changeDrawable, changeDrawNote, DRAWN_NOTE, NOT_DRAWN_NOTE, PROBABLE_NOTE, serviceChangeDraw, type ChangeDrawContext } from './changeDraw'
import type { Station } from './network'
import { stopStations, type SpanShape } from './tripSpans'

/** Four G stations 500 m apart along x, and one shape each way (the S one runs back), plus a short N variant. */
const station = (id: string, name: string, x: number): Station => ({
  id,
  name,
  pos: { x, z: 0 },
  routeIds: ['G'],
  stops: [`${id}N`, `${id}S`],
  access: { status: 'none' },
  leadId: id,
})
const stations = [station('G1', 'Alpha Av', 0), station('G2', 'Bravo St', 500), station('G3', 'Charlie Pl', 1000), station('G4', 'Delta Rd', 1500)]
const shape = (id: string, direction: 'N' | 'S', xs: number[], primary = true): SpanShape => {
  const points = xs.map((x) => ({ x, z: direction === 'N' ? -4.7 : 4.7 }))
  const cumulative = xs.map((x) => Math.abs(x - xs[0]!))
  return { id, routeId: 'G', direction, primary, points, cumulative, length: cumulative.at(-1)! }
}
const shapes = [shape('G..N', 'N', [0, 500, 1000, 1500]), shape('G..S', 'S', [1500, 1000, 500, 0]), shape('G..N2', 'N', [500, 1000], false)]
const ctx: ChangeDrawContext = { shapes, stationById: new Map(stations.map((s) => [s.id, s])), stopStations: stopStations(stations), serviceOf: null }

const at = (stop: string | null, direction: 'N' | 'S' | null = null, route = 'G'): AlertEntity => ({ route, stop, direction })
const alert = (type: string, header: string, entities: AlertEntity[]): ServiceAlert => ({ id: 'a', type, header, periods: [[0, null]], entities })

describe('serviceChangeDraw', () => {
  it('covers each primary shape of a whole-route suspension, whole, and lists every station of the route', () => {
    const d = serviceChangeDraw(alert('Planned - Suspended', 'No [G] trains', [at(null)]), ctx, 'a#1')!
    expect(d.route.suspended.map((s) => [s.shapeId, s.d0, s.d1])).toEqual([
      ['G..N', 0, 1500],
      ['G..S', 0, 1500],
    ])
    expect(d.route.rides).toEqual([])
    expect(d.route.marks).toEqual([])
    expect([...d.route.stations].sort()).toEqual(['G1', 'G2', 'G3', 'G4'])
    expect(d.route.key).toBe('a#1')
  })

  it('orders stops listed out of order along the shape, on the one direction they share', () => {
    const d = serviceChangeDraw(alert('Planned - Part Suspended', 'No [G] between Alpha Av and Charlie Pl', [at('G3', 'S'), at('G1', 'S'), at('G2', 'S')]), ctx, 'k')!
    expect(d.route.suspended.map((s) => [s.shapeId, s.d0, s.d1])).toEqual([['G..S', 500, 1500]])
  })

  it('marks the stations a skip header names, over the whole informed stretch both ways', () => {
    const d = serviceChangeDraw(alert('Planned - Stops Skipped', '[G] skips Bravo St', [at('G1'), at('G2'), at('G3')]), ctx, 'k')!
    expect(d.route.rides.map((r) => [r.shapeId, r.d0, r.d1])).toEqual([
      ['G..N', 0, 1000],
      ['G..S', 500, 1500],
    ])
    expect(d.route.marks).toEqual([{ stationId: 'G2', pos: { x: 500, z: 0 }, role: 'skip' }])
    expect(d.probable).toBe(false)
  })

  it('says probable when the header names no station (its guess drops the stretch ends)', () => {
    const d = serviceChangeDraw(alert('Planned - Stops Skipped', 'Some [G] trains run differently', [at('G1', 'N'), at('G2', 'N'), at('G3', 'N')]), ctx, 'k')!
    expect(d.probable).toBe(true)
    expect(d.route.marks.map((m) => m.stationId)).toEqual(['G2'])
    expect(d.route.rides).toHaveLength(1)
  })

  it('marks a single skipped station with no stretch', () => {
    const d = serviceChangeDraw(alert('Planned - Stops Skipped', '[G] skips Bravo St', [at('G2', 'N')]), ctx, 'k')!
    expect(d.route.rides).toEqual([])
    expect(d.route.marks.map((m) => m.stationId)).toEqual(['G2'])
  })

  it('warns and draws nothing for a route with no shape through its stations', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(serviceChangeDraw(alert('Planned - Part Suspended', 'No [Z]', [at('G1', null, 'Z'), at('G2', null, 'Z')]), ctx, 'k')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('draws nothing for a delay, a notice, or a suspension at one station', () => {
    expect(serviceChangeDraw(alert('Delays', 'Delays', [at(null)]), ctx, 'k')).toBeNull()
    expect(serviceChangeDraw(alert('Station Notice', 'Enter at Alpha Av', [at('G1')]), ctx, 'k')).toBeNull()
    expect(serviceChangeDraw(alert('Planned - Part Suspended', 'No [G] at Alpha Av', [at('G1')]), ctx, 'k')).toBeNull()
  })
})

describe('changeDrawable', () => {
  const by = ctx.stationById
  it('takes skips with a skip set, suspensions with a stretch of two stations or a whole route', () => {
    expect(changeDrawable(alert('Planned - Stops Skipped', '[G] skips Bravo St', [at('G2')]), by, null)).toBe(true)
    expect(changeDrawable(alert('Planned - Part Suspended', 'No [G]', [at('G2'), at('G3')]), by, null)).toBe(true)
    expect(changeDrawable(alert('Planned - Suspended', 'No [G]', [at(null)]), by, null)).toBe(true)
  })
  it('refuses other kinds, a part suspension with no stop, and stations the network lacks', () => {
    expect(changeDrawable(alert('Delays', 'Delays', [at(null)]), by, null)).toBe(false)
    expect(changeDrawable(alert('Planned - Part Suspended', 'No [G]', [at(null)]), by, null)).toBe(false)
    expect(changeDrawable(alert('Planned - Stops Skipped', '[G] skips X', [at('X1')]), by, null)).toBe(false)
    expect(changeDrawable(alert('Planned - Suspended', 'No [G]', [at('X1')]), by, null)).toBe(false)
    expect(changeDrawable(alert('Planned - Part Suspended', 'No [G] at Alpha Av', [at('G1')]), by, null)).toBe(false)
    expect(changeDrawable(alert('Planned - Suspended', 'No [Z]', [at(null, null, 'Z')]), by, null)).toBe(false)
  })
  it('agrees with what serviceChangeDraw draws on every synthetic case', () => {
    const cases = [
      alert('Planned - Stops Skipped', '[G] skips Bravo St', [at('G2', 'N')]),
      alert('Planned - Part Suspended', 'No [G] at Alpha Av', [at('G1')]),
      alert('Planned - Part Suspended', 'No [G]', [at('G1'), at('G3')]),
      alert('Planned - Suspended', 'No [G]', [at(null)]),
      alert('Planned - Suspended', 'No [G]', [at('G1'), at(null)]),
      alert('Delays', 'Delays', [at(null)]),
    ]
    for (const a of cases) expect(changeDrawable(a, by, null), a.header).toBe(serviceChangeDraw(a, ctx, 'k') !== null)
  })
})

describe('changeDrawNote', () => {
  it('says the drawing is ours, the skips a guess, or that nothing drew', () => {
    const drawn = serviceChangeDraw(alert('Planned - Stops Skipped', '[G] skips Bravo St', [at('G1'), at('G2'), at('G3')]), ctx, 'k')
    const guessed = serviceChangeDraw(alert('Planned - Stops Skipped', 'Some [G] trains', [at('G1'), at('G2'), at('G3')]), ctx, 'k')
    expect(changeDrawNote(drawn)).toBe(DRAWN_NOTE)
    expect(changeDrawNote(guessed)).toBe(PROBABLE_NOTE)
    expect(changeDrawNote(null)).toBe(NOT_DRAWN_NOTE)
    expect(changeDrawNote(drawn, '11:45 PM')).toBe('Drawn from the MTA notice · from 11:45 PM')
    expect(changeDrawNote(null, '11:45 PM')).toBe(NOT_DRAWN_NOTE)
    expect([DRAWN_NOTE, PROBABLE_NOTE, NOT_DRAWN_NOTE]).toEqual([
      'Drawn from the MTA notice',
      'Drawn from the MTA notice · skipped stops probably as shown',
      "Can't be drawn on the map",
    ])
  })
})

describe('serviceChangeDraw for an Express to Local change', () => {
  it('marks an added complex once, at its first added member, and draws the stretch round it', () => {
    // G2b is G2's complex sibling; the G normally calls at G1, G3 and G4 only.
    const sibling: Station = { ...station('G2b', 'Bravo St', 520), leadId: 'G2' }
    const all = [...stations, sibling]
    const service = { normal: new Set(['G1', 'G3', 'G4']), primary: ['G1', 'G3', 'G4'] }
    const local: ChangeDrawContext = { ...ctx, stationById: new Map(all.map((s) => [s.id, s])), stopStations: stopStations(all), serviceOf: () => service }
    const d = serviceChangeDraw(alert('Planned - Express to Local', '[G] runs local', [at('G2', 'N'), at('G2b', 'N')]), local, 'k')!
    expect(d.route.marks.map((m) => `${m.stationId}:${m.role}`)).toEqual(['G2:added'])
    expect([...d.route.stations].sort()).toEqual(['G1', 'G2', 'G2b', 'G3'])
    expect(d.route.rides).toHaveLength(1)
    expect(d.basis).toBe('timetable')
  })
})
