/**
 * TEMPORARY until the run motion is picked (6mg.7 review card). `?runs=eased` (default) drives each run between
 * stations as a trapezoid (pull away, cruise, brake; src/lib/realtime/runEase.ts); `?runs=linear` runs at constant
 * speed after the dwell, as before. Once decided, remove together:
 * - this file, and its use in useRealtimeStatic.ts
 * - prepareTrips.ts: `StaticRealtimeData.easedRuns` and its pass-through to planHop
 * - position.ts: `PositionInput.easedRuns`, `HopPlan.eased` and the branch in `hopFraction` (if linear wins, also
 *   runEase.ts and its test, and put the dwellReplay peak bound back to the average)
 * - the `eased` field in the HopPlan literals of carryReplay.ts, slots.test.ts, trainPick.test.ts, realData.test.ts
 * - AGENTS.md: the `?runs=` TEMPORARY note
 */
export type RunsLook = 'linear' | 'eased'

export function resolveRunsLook(search: string): RunsLook {
  return new URLSearchParams(search).get('runs') === 'linear' ? 'linear' : 'eased'
}

export const runsLook: RunsLook = resolveRunsLook(window.location.search)
