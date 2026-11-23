// Dwell on real public/data: no pattern hop needs an impossible speed, and a scheduled train replayed the way the client
// runs it (re-plan every 15 s, step every 0.5 s) holds at each stop, never jumps, never cross-fades, and arrives on time.
// The replay is a train on the static schedule (arrivals from segments.json), not worker/fixtures polls (those are
// single snapshots), and it covers only the no-VehiclePosition path.
// This test gates the daily data refresh (refresh-data.yml runs the tests): a failure on chore/data-refresh means the
// dwell rule or its cap needs another look, not that the data is wrong.
import { describe, expect, it } from 'vitest'
import segmentsRaw from '../../../public/data/segments.json?raw'
import shapesRaw from '../../../public/data/shapes.json?raw'
import stationsRaw from '../../../public/data/stations.json?raw'
import tripIndexRaw from '../../../public/data/trip-index.json?raw'
import { segmentKey } from '../../data/codec'
import type { SegmentsFile, ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { createSlotTable, reconcileSlots, stepSlot } from '../live/slots'
import { DWELL_MAX_SHARE, dwellFor, hopDistance, planHop } from './position'
import { rampShareFor } from './runEase'
import type { LiveTrip } from './prepareTrips'
import { buildShapeGeometries } from './shapeGeometry'
import { TRACK_OFFSET_M } from '../trackOffset'

const shapes = JSON.parse(shapesRaw) as ShapesFile
const stations = JSON.parse(stationsRaw) as StationsFile
const index = JSON.parse(tripIndexRaw) as TripIndexFile
const segments = (JSON.parse(segmentsRaw) as SegmentsFile).segments
const geometries = [...buildShapeGeometries(shapes, index, stations, TRACK_OFFSET_M, new Map()).values()]

const BASE = 1_795_228_554
const POLL_S = 15
const FRAME_S = 0.5
/** About a subway car's top speed (55 mph), which the eased run's cruise (its peak) must not exceed. */
const MAX_SPEED_MPS = 25
const MAX_STEP_M = 50
// The per-frame ease (tau 1.5 s) trails the target, so "at the stop" means within a dot's radius.
const STILL_M = 5
const MIN_STILL_S = 15

/** The scheduled run time of a hop. A missing segment throws: a silent fallback would test made-up run times. */
const runOf = (stops: readonly string[], k: number): number => {
  const runS = segments[segmentKey(stops[k]!, stops[k + 1]!)]
  if (runS === undefined) throw new Error(`no segment for ${stops[k]} > ${stops[k + 1]}`)
  return runS
}

describe('dwell on every real pattern hop', () => {
  it('needs at most 25 m/s at the eased run\'s cruise to cover each hop in its run time minus the dwell', () => {
    // The run cruises at 1 / (1 - rampShare) its average speed, so the peak, not the average, is what is bounded. The
    // fastest real hop averages about 19.7 m/s after its dwell; rampShareFor shortens the ramps of any hop whose full
    // ramps would cruise over 25 m/s, so only a hop averaging over 25 m/s fails here.
    let hops = 0
    for (const g of geometries) {
      for (let k = 0; k + 1 < g.stops.length; k++) {
        const runS = runOf(g.stops, k)
        const d = g.stopDistances[k + 1]! - g.stopDistances[k]!
        const moveS = runS - dwellFor(runS)
        const v = d / moveS / (1 - rampShareFor(d, moveS))
        hops++
        expect(v, `${g.shapeId} hop ${k}`).toBeLessThanOrEqual(MAX_SPEED_MPS)
      }
    }
    expect(hops).toBeGreaterThan(1000)
  })
})

describe('replaying a scheduled train on every real pattern', () => {
  it('holds at each stop, never jumps or cross-fades, and arrives by schedule end + 20 s', () => {
    let stopsChecked = 0
    for (const g of geometries) {
      const n = g.stops.length
      const D = g.stopDistances
      const T = [0]
      for (let k = 0; k + 1 < n; k++) T.push(T[k]! + runOf(g.stops, k))
      const end = T[n - 1]!
      const table = createSlotTable(1)
      const stillFor = new Array<number>(n).fill(0)
      let prev = NaN
      let problem: string | undefined
      for (let t = 0; t <= end + 20; t += FRAME_S) {
        if (t % POLL_S === 0 && t <= end) {
          // A feed lists only the stops still ahead, in order; no VehiclePosition.
          const arrivals = g.stops.flatMap((s, k) => (T[k]! >= t ? [[s, BASE + T[k]!] as [string, number]] : []))
          const plan = planHop({ geometry: g, status: null, stopId: null, arrivals, segments, now: BASE + t })
          if ('ok' in plan) throw new Error(`${g.shapeId} at +${t}: ${plan.reason}`)
          const trip = { key: 't', shapeId: g.shapeId, geometry: g, plan } as unknown as LiveTrip
          reconcileSlots(table, [trip], t, { dataNow: BASE + t, reducedMotion: false })
        }
        const shown = stepSlot(table, 0, hopDistance(table.trips[0]!.plan, g, BASE + t), BASE + t, t, FRAME_S)
        // Cheap checks inline (one `expect` per frame would dominate the run); the first problem is reported.
        if (table.phase[0] !== 0) problem ??= `+${t}: cross-fade`
        else if (shown - prev < 0 || shown - prev > MAX_STEP_M) problem ??= `+${t}: step ${shown - prev} m`
        prev = shown
        for (let k = 1; k < n - 1; k++) if (Math.abs(shown - D[k]!) < STILL_M) stillFor[k]! += FRAME_S
      }
      expect(problem, g.shapeId).toBeUndefined()
      expect(prev, `${g.shapeId}: reaches the last stop`).toBeGreaterThanOrEqual(D[n - 1]! - STILL_M)
      for (let k = 1; k < n - 1; k++) {
        stopsChecked++
        // A short hop only dwells for its capped share, so ask for 15 s only where the dwell can last that long.
        const want = Math.min(MIN_STILL_S, 0.75 * Math.min(30, DWELL_MAX_SHARE * runOf(g.stops, k)))
        expect(stillFor[k]!, `${g.shapeId} stop ${k} (${g.stops[k]})`).toBeGreaterThanOrEqual(want)
      }
    }
    expect(stopsChecked).toBeGreaterThan(1000)
  })
})
