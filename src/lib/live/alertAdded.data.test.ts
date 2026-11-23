/**
 * The added stops on the committed trip patterns and the recorded alerts feed (worker/fixtures/alerts.json, through the
 * Worker's own transform): the D's uptown local run on Central Park West and the 7X's stop at 74 St.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from '../../../worker/src/alerts'
import type { ShapesFile, TripIndexFile } from '../../data/schema'
import { buildTripLookup } from '../realtime/tripLookup'
import { realStations } from '../realGroups.testdata'
import { addedSetsOf, serviceIndex } from './alertAdded'

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const lookup = buildTripLookup(read<TripIndexFile>('public/data/trip-index.json'), read<ShapesFile>('public/data/shapes.json'))
const stationById = new Map(realStations.map((s) => [s.id, s]))
const serviceOf = serviceIndex(lookup, stationById)
const FEED = read<unknown>('worker/fixtures/alerts.json')
/** The feed's own timestamp, inside a period of the 7/7X alert. */
const FEED_AT = 1795465325
/** 2026-12-19 06:01 GMT, inside 36538's one period. */
const LOCAL_AT = 1797660060
const alertAt = (id: string, nowS: number) => transformAlerts(FEED, nowS).snapshot.alerts.find((a) => a.id === `lmm:planned_work:${id}`)!
const sets = (id: string, nowS: number) =>
  addedSetsOf(alertAt(id, nowS), { stationById, serviceOf }).map((s) => ({ route: s.route, direction: s.direction, stations: [...s.stations].sort() }))

describe('addedSetsOf on the recorded alerts', () => {
  it('adds 72 St to 116 St to the uptown D, not the stations it calls at anyway', () => {
    expect(sets('36538', LOCAL_AT)).toEqual([{ route: 'D', direction: 'N', stations: ['A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22'] }])
  })

  it('adds 74 St-Broadway to the 7X, and nothing to the 7, which always stops there', () => {
    expect(sets('31871', FEED_AT)).toEqual([{ route: '7X', direction: 'N', stations: ['710'] }])
  })
})

describe('serviceIndex on the committed patterns', () => {
  it("leaves the D's night-only 4 Av locals out of its normal uptown service", () => {
    const d = serviceOf('D', 'N')!
    expect(d.normal.has('R32')).toBe(false)
    expect(d.normal.has('R36')).toBe(true)
  })

  it('counts both A branches as normal, Far Rockaway and Lefferts Blvd', () => {
    const a = serviceOf('A', 'N')!
    for (const id of ['H11', 'A65']) expect(a.normal.has(id), id).toBe(true)
  })
})
