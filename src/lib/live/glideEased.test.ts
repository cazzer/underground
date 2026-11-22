// A catch-up glide over an eased run (runEase.ts): the plan's own speed changes under the glide, and a poll that
// lands mid-glide must continue it without a step or a change of speed.
import { describe, expect, it } from 'vitest'
import { buildPolyline } from '../realtime/polyline'
import { hopDistance, type HopPlan } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { EMPTY_PROFILE } from '../trackProfile'
import { createSlotTable, reconcileSlots, stepSlot, type SlotTable } from './slots'

const DT = 1 / 60
const geometry: ShapeGeometry = {
  shapeId: 'S',
  line: buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }]),
  stops: ['a', 'b'],
  stopDistances: [0, 1000],
  maxStopOffsetM: 0,
  profile: EMPTY_PROFILE,
  bandInputs: new Float32Array(0),
}
/** A 100 s eased run due at 1000 m at `arriveAt`. */
function trip(arriveAt: number): LiveTrip {
  const plan: HopPlan = {
    from: 0,
    to: 1,
    arriveAt,
    runS: 100,
    dwellS: 0,
    fixedFraction: null,
    minFraction: 0,
    departsInS: null,
    capped: false,
    eased: true,
  }
  return { key: 'a', shapeId: 'S', plan, geometry } as unknown as LiveTrip
}

/** A dot shown at 500 m when a poll at `dataNow` 1000 says it is on `next`: 1000 to 1025 s, polled again at `repoll`. */
function run(next: LiveTrip, repoll: number | null): { shown: number[]; table: SlotTable; continued: boolean } {
  const table = createSlotTable(1)
  reconcileSlots(table, [next], 0, { dataNow: 990, reducedMotion: false })
  table.displayed[0] = 500
  reconcileSlots(table, [next], 10, { dataNow: 1000, reducedMotion: false })
  const shown: number[] = []
  let continued = false
  for (let k = 0; k <= 25 / DT; k++) {
    const now = 1000 + k * DT
    if (repoll !== null && k === Math.round((repoll - 1000) / DT)) {
      const end = table.glideAt[0]! + table.glideT[0]!
      reconcileSlots(table, [next], 10 + k * DT, { dataNow: now, reducedMotion: false })
      continued = table.glideAt[0]! + table.glideT[0]! === end
    }
    shown.push(stepSlot(table, 0, hopDistance(table.trips[0]!.plan, geometry, now), now, 10 + k * DT, DT))
  }
  return { shown, table, continued }
}

describe('a glide over an eased run', () => {
  // Due at 1020: at 1000 the run is 80% through, braking from 875 m; the dot at 500 m glides 375 m.
  it('continues across a poll with the same plan exactly as if no poll had landed', () => {
    const alone = run(trip(1020), null)
    const polled = run(trip(1020), 1003)
    expect(polled.continued).toBe(true)
    for (let k = 0; k < alone.shown.length; k++) expect(polled.shown[k]!, `frame ${k}`).toBeCloseTo(alone.shown[k]!, 6)
  })

  it('never steps back, and reaches the stop within 5 s of the train', () => {
    const { shown } = run(trip(1020), 1003)
    for (let k = 1; k < shown.length; k++) expect(shown[k]!).toBeGreaterThanOrEqual(shown[k - 1]!)
    expect(1000 - shown[shown.length - 1]!).toBeLessThan(5)
  })
})
