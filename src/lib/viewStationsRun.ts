/**
 * The per-frame decision of the stations-in-view hook (o3r.2, o3r.8), out of React so its rules are tested: when the
 * view choice and the wider prefetch choice run, and when their stores are written or emptied. Allocation-free except
 * the id list built when a store changes.
 *
 * Privacy: the only inputs are the camera pose, the free rect, the focused index and whether the location cap is in
 * force; while it is, both stores are emptied and nothing is chosen, even right after a publish.
 */
import { markSelected, newPose, newReselect, reselectDue, type ReselectState, type ViewPose } from './basemap/reselect'
import type { ToScreen } from './pick'
import type { ViewStationSet } from './viewStationSet'
import {
  chooseViewStations,
  MAX_PREFETCH_STATIONS,
  MAX_VIEW_STATIONS,
  newViewScratch,
  PREFETCH_FAR,
  sameMembers,
  viewMovedEnough,
  viewZones,
  type ViewQuery,
  type ViewScratch,
  type ViewStationSpace,
} from './viewStations'

const NO_IDS: readonly string[] = []

export interface ViewRun {
  space: ViewStationSpace
  scratch: ViewScratch
  /** The camera pose of this frame; the caller writes it before each `stepViewChoice`. */
  pose: ViewPose
  reselect: ReselectState
  /** The view choice's query (its `free` and `focused` are the caller's to set) and the prefetch choice's. */
  query: ViewQuery
  pquery: ViewQuery
  /** The last choices' group indices, the hysteresis input (`query.previous`, `pquery.previous`). */
  chosen: Int32Array
  chosenCount: number
  pchosen: Int32Array
  pchosenCount: number
  next: Int32Array
  pnext: Int32Array
  /** What each store was last given (indices), apart from `chosen`, which every choice overwrites for the hysteresis. */
  published: Int32Array
  publishedCount: number
  ppublished: Int32Array
  ppublishedCount: number
  /** The last frame's `viewZones`, -1 before the first. */
  zones: number
  /** Set by anything that changes the answer without moving the camera (free rect, focus); cleared by a choice. */
  dirty: boolean
}

export function newViewRun(space: ViewStationSpace, toScreen: ToScreen): ViewRun {
  const query: ViewQuery = {
    distance: 0,
    tx: 0,
    tz: 0,
    free: { left: 0, top: 0, right: 0, bottom: 0 },
    toScreen,
    focused: -1,
    previous: new Int32Array(MAX_VIEW_STATIONS),
    previousCount: 0,
  }
  // The prefetch choice: no focused head, wider and larger, its own hysteresis.
  const pquery: ViewQuery = { ...query, previous: new Int32Array(MAX_PREFETCH_STATIONS), far: PREFETCH_FAR, max: MAX_PREFETCH_STATIONS }
  return {
    space,
    // One scratch serves both choices (its `was` is left clean by each, its scores are sized for the larger).
    scratch: newViewScratch(space, MAX_PREFETCH_STATIONS),
    pose: newPose(),
    reselect: newReselect(),
    query,
    pquery,
    chosen: query.previous,
    chosenCount: 0,
    pchosen: pquery.previous,
    pchosenCount: 0,
    next: new Int32Array(MAX_VIEW_STATIONS),
    pnext: new Int32Array(MAX_PREFETCH_STATIONS),
    published: new Int32Array(MAX_VIEW_STATIONS),
    publishedCount: 0,
    ppublished: new Int32Array(MAX_PREFETCH_STATIONS),
    ppublishedCount: 0,
    zones: -1,
    dirty: true,
  }
}

/** Writes `next[0..n)` to `target` unless it already holds what `published` says was last written (`firstMatters`: a focused station leads). Returns the published count. */
function publishChoice(
  target: ViewStationSet,
  space: ViewStationSpace,
  next: Int32Array,
  n: number,
  published: Int32Array,
  publishedCount: number,
  firstMatters: boolean,
): number {
  // Against what was published, not the last choice, so a drift of unpublished choices never hides a change; and the
  // store's own length too, since another run's cleanup may have emptied it after this run last published.
  if (sameMembers(next, n, published, publishedCount, firstMatters) && target.get().length === n) return publishedCount
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    published[i] = next[i]!
    ids.push(space.ids[next[i]!]!)
  }
  target.set(ids)
  return n
}

/** Empties both stores and forgets the run's choices (the scene goes, or the cap is on). */
export function emptyViewRun(run: ViewRun, set: ViewStationSet, prefetch: ViewStationSet): void {
  run.chosenCount = 0
  run.publishedCount = 0
  run.pchosenCount = 0
  run.ppublishedCount = 0
  if (set.get().length > 0) set.set(NO_IDS)
  if (prefetch.get().length > 0) prefetch.set(NO_IDS)
}

/**
 * One frame, with `run.pose` already written. Under the location cap: both stores emptied, the timing kept current,
 * the next frame dirty so the first one after the cap lifts chooses. Otherwise a choice runs when `reselectDue` says so
 * (timing from the tiles' rule, "changed enough" from `viewMovedEnough`) or when `viewZones` changed since the last
 * frame (crossing a gate, either way, chooses now); `prepare` runs just before it (the caller points its projection at
 * this frame's camera). The view choice runs first, then the prefetch choice; each store is written only on a change.
 */
export function stepViewChoice(
  run: ViewRun,
  capped: boolean,
  now: number,
  prepare: () => void,
  set: ViewStationSet,
  prefetch: ViewStationSet,
): void {
  const p = run.pose
  const zones = viewZones(p.distance)
  const urgent = zones !== run.zones
  if (urgent) {
    run.zones = zones
    run.dirty = true
  }
  if (capped) {
    reselectDue(run.reselect, p, now)
    emptyViewRun(run, set, prefetch)
    run.dirty = true
    return
  }
  // The tiles' own "meaningful change" is too coarse here (a 10% pan is over 100 px), so this view's test goes in as `slidOut`.
  const sel = run.reselect.selected
  const due = reselectDue(run.reselect, p, now, run.dirty || (sel !== null && viewMovedEnough(sel, p)))
  if (!due && !urgent) return
  prepare()
  const q = run.query
  q.distance = p.distance
  q.tx = p.tx
  q.tz = p.tz
  q.previousCount = run.chosenCount
  const n = chooseViewStations(run.space, q, run.scratch, run.next)
  for (let i = 0; i < n; i++) run.chosen[i] = run.next[i]!
  run.chosenCount = n
  const pq = run.pquery
  pq.distance = p.distance
  pq.tx = p.tx
  pq.tz = p.tz
  pq.previousCount = run.pchosenCount
  const pn = chooseViewStations(run.space, pq, run.scratch, run.pnext)
  for (let i = 0; i < pn; i++) run.pchosen[i] = run.pnext[i]!
  run.pchosenCount = pn
  run.dirty = false
  markSelected(run.reselect, p, now)
  run.publishedCount = publishChoice(set, run.space, run.next, n, run.published, run.publishedCount, q.focused >= 0)
  run.ppublishedCount = publishChoice(prefetch, run.space, run.pnext, pn, run.ppublished, run.ppublishedCount, false)
}
