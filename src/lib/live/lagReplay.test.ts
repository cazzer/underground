// Train lag on recorded polls (underground-d80, underground-dk6): replays src/test-fixtures/rt-polls.json through the
// client's own per-poll and per-frame code (pollReplay.ts) and times when each dot reaches a stop against when the feed
// first reported the train STOPPED_AT there.
import { describe, expect, it } from 'vitest'
import { DRAWN_BEFORE_S, MAX_STEP_M, PAST_PLATFORM_M, feedArrivals, quantile, replay } from './pollReplay'

describe('replaying recorded polls', () => {
  const run = replay()
  const lags = feedArrivals().flatMap((e) => {
    const born = run.firstDrawn.get(e.key)
    const at = run.reached.get(`${e.key}|${e.stopId}`)
    return born === undefined || born > e.at - DRAWN_BEFORE_S || at === undefined ? [] : [at - e.at]
  })

  it('times enough arrivals across the A, B and L divisions', () => {
    expect(lags.length).toBeGreaterThanOrEqual(25)
  })

  it('shows a train reaching its stop early (median), within 25 s late (p90) and not much over half a minute early (p10)', () => {
    // arrivalShift.ts leans every dot early on purpose: the feed is seen about 23 s after the train is in, so with no
    // shift the median was 9 s late and a train in the station was often still a block away. The price is the p10: a
    // train that dwells longer than its run table says is shown arriving early, about 26 s before the feed has it here
    // (measured), so the bound is "not half a minute early", not "never early".
    expect(quantile(lags, 0.5)).toBeLessThanOrEqual(0)
    expect(quantile(lags, 0.9)).toBeLessThanOrEqual(25)
    expect(quantile(lags, 0.1)).toBeGreaterThanOrEqual(-35)
  })

  it(`keeps a dot within ${PAST_PLATFORM_M} m of a platform the next poll still has the train at`, () => {
    expect(run.maxPastPlatformM).toBeLessThanOrEqual(PAST_PLATFORM_M)
  })

  it(`never moves a visible dot more than ${MAX_STEP_M} m in one frame, or backward`, () => {
    expect(run.maxStepM).toBeLessThanOrEqual(MAX_STEP_M)
    expect(run.maxBackM).toBeLessThanOrEqual(0.01)
  })
})
