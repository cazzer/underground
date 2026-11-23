/**
 * The change draw on the committed public/data and the recorded alerts feed (worker/fixtures/alerts.json, through the
 * Worker's own transform): the acceptance cases. Spans are checked by where they lie, never by shape id (the daily
 * refresh changes those).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { transformAlerts } from '../../worker/src/alerts'
import type { ServiceAlert } from '../data/realtime'
import type { RoutesFile, ShapesFile, StationsFile, TripIndexFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import { changeDrawable, changeDrawNote, NAMES_NOTE, serviceChangeDraw, TIMETABLE_NOTE, type ChangeDraw, type ChangeDrawContext } from './changeDraw'
import { serviceIndex } from './live/alertAdded'
import { buildNetwork } from './network'
import { buildTripLookup } from './realtime/tripLookup'
import { bandNetwork } from './networkBands'
import type { Ground } from './projection'
import { TRACK_OFFSET_M } from './trackOffset'
import { spanPoints, stopStations, type RideShapeSpan } from './tripSpans'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const network = buildNetwork(
  read<StationsFile>('stations.json'),
  read<RoutesFile>('routes.json'),
  read<ShapesFile>('shapes.json'),
  TRACK_OFFSET_M,
  read<PackedDepthsFile>('station-depths.json'),
  2,
)
const banded = bandNetwork(network)
const serviceOf = serviceIndex(buildTripLookup(read<TripIndexFile>('trip-index.json'), read<ShapesFile>('shapes.json')), network.stationById)
const ctx: ChangeDrawContext = { shapes: banded.shapes, stationById: network.stationById, stopStations: stopStations(network.stations), serviceOf }
const shapeById = new Map(banded.shapes.map((s) => [s.id, s]))
const FEED = JSON.parse(readFileSync('worker/fixtures/alerts.json', 'utf8')) as unknown
/** The feed's own timestamp; 2026-12-15 05:01 GMT, in the Q reroute's first period (36553); 2026-12-19 06:01 GMT, in the D's local run (36538). */
const FEED_AT = 1795465325
const REROUTE_AT = 1797310860
const LOCAL_AT = 1797660060
/** Every alert of the feed, from the Worker's answers at the three times (the two later ones are outside the first's day). */
const everyAlert = [
  ...new Map([FEED_AT, REROUTE_AT, LOCAL_AT].flatMap((t) => transformAlerts(FEED, t).snapshot!.alerts).map((a) => [a.id, a])).values(),
]
const alertOf = (id: string): ServiceAlert => everyAlert.find((a) => a.id === `lmm:planned_work:${id}`)!

function draw(id: string): ChangeDraw {
  const d = serviceChangeDraw(alertOf(id), ctx, `${id}#1`)
  if (!d) throw new Error(`alert ${id} drew nothing`)
  return d
}
const pos = (id: string): Ground => network.stationById.get(id)!.pos
const ends = (span: RideShapeSpan): [Ground, Ground] => {
  const pts = spanPoints(shapeById.get(span.shapeId)!, span.d0, span.d1)
  return [pts[0]!, pts.at(-1)!]
}
const near = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)
const directionOf = (span: RideShapeSpan) => shapeById.get(span.shapeId)!.direction
const marked = (d: ChangeDraw) => d.route.marks.map((m) => m.stationId).sort()

describe('serviceChangeDraw on the recorded feed', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('draws the Manhattan-bound R from 36 St to Atlantic Av on its N track, the four skipped stations marked', () => {
    const d = draw('35972')
    expect(d.route.kind).toBe('change')
    expect(d.route.rides).toHaveLength(1)
    const ride = d.route.rides[0]!
    expect(ride.routeId).toBe('R')
    expect(directionOf(ride)).toBe('N')
    const [a, b] = ends(ride)
    expect(near(a, pos('R36'))).toBeLessThan(30)
    expect(near(b, pos('R31'))).toBeLessThan(30)
    expect(marked(d)).toEqual(['R32', 'R33', 'R34', 'R35'])
    expect(d.route.marks.every((m) => m.role === 'skip')).toBe(true)
    expect(d.route.suspended).toEqual([])
    expect(d.probable).toBe(false)
    expect([...d.route.stations].sort()).toEqual(['R31', 'R32', 'R33', 'R34', 'R35', 'R36'])
    expect(d.route.frameStations).toHaveLength(6)
  })

  it('draws the 7 over its whole informed run, marking only 52 St and 69 St (Woodside keeps its ring)', () => {
    const d = draw('31498')
    expect(d.route.rides).toHaveLength(1)
    expect(directionOf(d.route.rides[0]!)).toBe('N')
    const [a, b] = ends(d.route.rides[0]!)
    expect(Math.min(near(a, pos('711')), near(a, pos('713')))).toBeLessThan(30)
    expect(Math.min(near(b, pos('711')), near(b, pos('713')))).toBeLessThan(30)
    expect(marked(d)).toEqual(['711', '713'])
    expect(d.route.stations).toContain('712')
  })

  it('draws the downtown 4 and 6 both on S tracks, with one mark per skipped station, 51 St at its own point', () => {
    const d = draw('35976')
    expect(d.route.rides.map((r) => r.routeId).sort()).toEqual(['4', '6'])
    for (const r of d.route.rides) expect(directionOf(r)).toBe('S')
    expect(d.route.marks).toHaveLength(7)
    const st51 = d.route.marks.find((m) => m.stationId === '630')!
    expect(st51.pos).toEqual({ x: pos('630').x, z: pos('630').z })
    const siblings = network.groupById.get('630')!.memberIds.filter((m) => m !== '630')
    expect(siblings.length).toBeGreaterThan(0)
    for (const s of siblings) expect(marked(d)).not.toContain(s)
  })

  it('draws the N part suspension dashed both ways from Queensboro Plaza to Times Sq, with no ride and no mark', () => {
    const d = draw('35962')
    expect(d.route.rides).toEqual([])
    expect(d.route.marks).toEqual([])
    expect(d.route.suspended.map(directionOf).sort()).toEqual(['N', 'S'])
    for (const s of d.route.suspended) {
      const [a, b] = ends(s)
      const at = [a, b].map((p) => Math.min(near(p, pos('R09')), near(p, pos('R16'))))
      expect(Math.max(...at)).toBeLessThan(30)
    }
    expect(d.route.stations).toEqual(expect.arrayContaining(['R09', 'R16']))
  })

  it('draws the 5 suspension with stops over its stretch from Dyre Av to E 180 St', () => {
    const d = draw('35952')
    expect(d.route.suspended.length).toBeGreaterThan(0)
    for (const s of d.route.suspended) {
      expect(s.routeId).toBe('5')
      const [a, b] = ends(s)
      const at = [a, b].map((p) => Math.min(near(p, pos('501')), near(p, pos('213'))))
      expect(Math.max(...at)).toBeLessThan(30)
    }
  })

  it('draws the uptown D local from 59 St to 125 St, marking the seven stops it adds and neither end', () => {
    const d = draw('36538')
    expect(d.basis).toBe('timetable')
    expect(changeDrawNote(d)).toBe(TIMETABLE_NOTE)
    expect(d.route.rides).toHaveLength(1)
    const ride = d.route.rides[0]!
    expect(ride.routeId).toBe('D')
    expect(directionOf(ride)).toBe('N')
    const [a, b] = ends(ride)
    expect(near(a, pos('A24'))).toBeLessThan(30)
    expect(near(b, pos('A15'))).toBeLessThan(30)
    expect(marked(d)).toEqual(['A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22'])
    expect(d.route.marks.every((m) => m.role === 'added')).toBe(true)
    expect([...d.route.stations].sort()).toEqual(['A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A24'])
    expect(d.route.suspended).toEqual([])
  })

  it('draws the 7X from 61 St-Woodside to Junction Blvd through 74 St, its one added stop', () => {
    const d = draw('31871')
    expect(d.route.rides.map((r) => r.routeId)).toEqual(['7X'])
    const [a, b] = ends(d.route.rides[0]!)
    expect(near(a, pos('712'))).toBeLessThan(30)
    expect(near(b, pos('707'))).toBeLessThan(30)
    expect(d.route.marks).toEqual([{ stationId: '710', pos: { x: pos('710').x, z: pos('710').z }, role: 'added' }])
  })

  it('marks only the Q reroute\'s named stations, Canal St once and DeKalb Av, with no path', () => {
    const d = draw('36553')
    expect(d.basis).toBe('names')
    expect(changeDrawNote(d)).toBe(NAMES_NOTE)
    expect(d.route.rides).toEqual([])
    expect(d.route.suspended).toEqual([])
    expect(marked(d)).toEqual(['Q01', 'R30'])
    expect(d.route.marks.every((m) => m.role === 'named')).toBe(true)
    expect([...d.route.stations].sort()).toEqual(['Q01', 'R23', 'R30'])
    expect(d.route.frameStations).toEqual([pos('Q01'), pos('R30')].map((p) => ({ x: p.x, z: p.z })))
  })

  it('draws no added stop while the normal service is unknown', () => {
    expect(serviceChangeDraw(alertOf('36538'), { ...ctx, serviceOf: null }, 'k')).toBeNull()
    expect(changeDrawable(alertOf('36538'), network.stationById, null)).toBe(false)
  })

  it('finds every stretch of the feed on a drawn line (nothing warned)', () => {
    warn.mockClear()
    for (const a of everyAlert) serviceChangeDraw(a, ctx, 'k')
    expect(warn).not.toHaveBeenCalled()
  })

  it('makes a row a button exactly when it draws something, for every alert of the feed', () => {
    for (const a of everyAlert) expect(changeDrawable(a, network.stationById, serviceOf), a.id).toBe(serviceChangeDraw(a, ctx, 'k') !== null)
  })

  it('draws nothing for a delay or a notice', () => {
    for (const a of everyAlert.filter((x) => !/Skipped|Suspended|Local|Reroute/.test(x.type ?? ''))) expect(serviceChangeDraw(a, ctx, 'k')).toBeNull()
  })
})
