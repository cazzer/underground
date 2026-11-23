import { describe, expect, it } from 'vitest'
import { createViewStationSet } from './viewStationSet'
import { GATE_KEEP_FACTOR, PREFETCH_FAR } from './viewStations'
import { newViewRun, stepViewChoice, type ViewRun } from './viewStationsRun'
import { FREE, H, lone, spaceOf, topDown, W } from './viewStationsFixture'
import { REVEAL_FAR } from './interiorReveal'

/** One station 100 m east of the target, in a top-down view 1000 x 800. */
function setup(): { run: ViewRun; set: ReturnType<typeof createViewStationSet>; prefetch: ReturnType<typeof createViewStationSet>; calls: { n: number } } {
  const run = newViewRun(spaceOf([lone('A', 100, 0)]), topDown(0, 0))
  run.query.free = FREE
  run.pquery.free = FREE
  run.pose.width = W
  run.pose.height = H
  return { run, set: createViewStationSet(), prefetch: createViewStationSet(), calls: { n: 0 } }
}

describe('stepViewChoice', () => {
  it('chooses on the first frame and writes both stores', () => {
    const { run, set, prefetch, calls } = setup()
    run.pose.distance = 1100
    stepViewChoice(run, false, 0, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(1)
    expect(set.get()).toEqual(['A'])
    expect(prefetch.get()).toEqual(['A'])
  })

  it('under the location cap empties both stores at once, even right after a publish', () => {
    const { run, set, prefetch, calls } = setup()
    run.pose.distance = 1100
    stepViewChoice(run, false, 0, () => calls.n++, set, prefetch)
    expect(set.get()).toEqual(['A'])
    stepViewChoice(run, true, 16, () => calls.n++, set, prefetch)
    expect(set.get()).toEqual([])
    expect(prefetch.get()).toEqual([])
    expect(calls.n).toBe(1)
    // A capped view at prefetch range chooses nothing either, however long it holds.
    run.pose.distance = 2000
    for (let t = 32; t < 2000; t += 100) stepViewChoice(run, true, t, () => calls.n++, set, prefetch)
    expect(prefetch.get()).toEqual([])
    expect(calls.n).toBe(1)
  })

  it('chooses on the first frame after the cap lifts', () => {
    const { run, set, prefetch, calls } = setup()
    run.pose.distance = 1100
    stepViewChoice(run, false, 0, () => calls.n++, set, prefetch)
    stepViewChoice(run, true, 16, () => calls.n++, set, prefetch)
    stepViewChoice(run, true, 100, () => calls.n++, set, prefetch)
    stepViewChoice(run, false, 200, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(2)
    expect(set.get()).toEqual(['A'])
    expect(prefetch.get()).toEqual(['A'])
  })

  it('chooses when a gate zone changes though the timing says not yet, both ways', () => {
    const { run, set, prefetch, calls } = setup()
    run.pose.distance = 1000
    stepViewChoice(run, false, 0, () => calls.n++, set, prefetch)
    // Zooms out across REVEAL_FAR 10 ms later: not due by timing (moved just now), but the zone changed.
    run.pose.distance = REVEAL_FAR + 10
    stepViewChoice(run, false, 10, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(2)
    // Past its keep distance the view set empties, the prefetch one stays.
    run.pose.distance = REVEAL_FAR * GATE_KEEP_FACTOR + 10
    stepViewChoice(run, false, 20, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(3)
    expect(set.get()).toEqual([])
    expect(prefetch.get()).toEqual(['A'])
    // Across PREFETCH_FAR and its keep distance the prefetch set goes too.
    run.pose.distance = PREFETCH_FAR * GATE_KEEP_FACTOR + 10
    stepViewChoice(run, false, 30, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(4)
    expect(prefetch.get()).toEqual([])
    // And back in, at once.
    run.pose.distance = 1100
    stepViewChoice(run, false, 40, () => calls.n++, set, prefetch)
    expect(calls.n).toBe(5)
    expect(set.get()).toEqual(['A'])
  })

  it('hovering inside a zone chooses only on the reselect timing', () => {
    const { run, set, prefetch, calls } = setup()
    run.pose.distance = 1100
    stepViewChoice(run, false, 0, () => calls.n++, set, prefetch)
    // Pans 2 m a frame: a move past the 2% choice threshold by frame 12, but still moving, so due only every 500 ms.
    let chosenAt = -1
    for (let k = 1; k <= 40; k++) {
      const before = calls.n
      run.pose.tx = 2 * k
      stepViewChoice(run, false, 16 * k, () => calls.n++, set, prefetch)
      if (calls.n > before && chosenAt < 0) chosenAt = 16 * k
    }
    expect(chosenAt).toBe(512)
    expect(calls.n).toBe(2)
  })
})
