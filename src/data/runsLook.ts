/**
 * TEMPORARY until the run motion is picked (6mg.7 review card). `?runs=eased` (default) drives each run between
 * stations as a trapezoid (pull away, cruise, brake; src/lib/realtime/runEase.ts); `?runs=linear` runs at constant
 * speed after the dwell, as before. Once decided, remove together:
 * - this file, and its use in useRealtimeStatic.ts
 * - prepareTrips.ts: `StaticRealtimeData.easedRuns` and its pass-through to planHop
 * - position.ts: `PositionInput.easedRuns`, `HopPlan.eased` and the `!plan.eased` branch in `hopFraction`
 * - positionRun.test.ts: the `easedRuns: false` case
 * - AGENTS.md: the `?runs=` TEMPORARY note
 * If eased wins, also:
 * - drop `eased` from the HopPlan literals of carryReplay.ts, trainPick.test.ts and realData.test.ts (fixed plans, so
 *   `rampShare` doesn't matter there either), and re-check slots.test.ts: its `dist()` and speed bounds assume a
 *   constant-speed plan, so give its plan `rampShare: 0` (constant speed) or rework those expectations
 * If linear wins, also:
 * - delete runEase.ts, runEase.test.ts and positionRun.test.ts, and `HopPlan.rampShare` (planHop, its docstring on
 *   positionAlongShape, and every HopPlan literal)
 * - dwellReplay.test.ts: bound the average again, `d / moveS`, not the cruise
 * - glideEased.test.ts: keep it, on a constant-speed plan (its continue and sliver cases cover the glide, not the ease)
 * - position.test.ts: the eased expectations go back to linear (1750 at 17.5 s left; INCOMING_AT 1900 at 7 s left)
 * - AGENTS.md: the position.ts sentence on the eased run (`runEase.ts` `easeRun`)
 */
export type RunsLook = 'linear' | 'eased'

export function resolveRunsLook(search: string): RunsLook {
  return new URLSearchParams(search).get('runs') === 'linear' ? 'linear' : 'eased'
}

export const runsLook: RunsLook = resolveRunsLook(window.location.search)
