/**
 * The stations in view (o3r.2): which station leads (complexes once) the scene should reveal because the camera
 * looks at them, not because they are focused. Pure and allocation-free in `chooseViewStations`, so the scene
 * hook can run it from a frame.
 *
 * A group qualifies while the camera is closer than REVEAL_FAR (the interior's reveal begins there) when any
 * member's ground point projects inside the free rect (interiorFreeRect: between the header and footer bands,
 * beside or above the panel) and lies within REACH_SHARE x the camera distance of the orbit target on the ground,
 * which keeps points near the horizon of a tilted view out. Ranked by the nearest qualifying member's screen
 * distance to the free rect's middle; the focused lead is always first and counts toward the cap. Hysteresis keeps
 * the set from flapping: a previous pick stays inside the free rect padded KEEP_PAD_SHARE per side and within
 * KEEP_REACH_FACTOR x the reach, and ranks KEEP_RANK_SHARE x half the free rect's diagonal nearer than it is.
 *
 * Inputs are the camera, the free rect and the focused id only: never the location fix or the nearest station.
 */
import type { StationId } from '../data/schema'
import { differs, type ViewPose } from './basemap/reselect'
import type { ScreenRect } from './interiorCamera'
import { REVEAL_FAR } from './interiorReveal'
import type { ScreenPoint, ToScreen } from './pick'
import type { Ground } from './projection'
import type { StationGroup } from './stationGroups'

/** Most stations chosen at once, the focused one included. */
export const MAX_VIEW_STATIONS = 4
/**
 * Most station interiors drawn at once (o3r.4), the focused one included: each costs four to eight line layers, a few
 * level label divs and its share of the lifted trains, so three keeps a phone's frame rate (the look card's cap).
 */
export const MAX_VIEW_INTERIORS = 3
/** Ground reach from the orbit target, as a share of the camera distance (a horizon guard; test 15 pins it). */
export const REACH_SHARE = 1.5
/** A previous pick stays inside the free rect with each side moved out by this share of its width / height. */
export const KEEP_PAD_SHARE = 0.15
/** A previous pick stays out to this multiple of the reach. */
export const KEEP_REACH_FACTOR = 1.25
/** A previous pick ranks this share of the free rect's half-diagonal nearer than it is. */
export const KEEP_RANK_SHARE = 0.1

/** A set that is not empty stays until the camera is this multiple of REVEAL_FAR away, so hovering at the gate doesn't flip it. */
export const GATE_KEEP_FACTOR = 1.04
/** This view's own "changed enough" test (tighter than the tiles'): a pan past this share of the distance (about 25 px), */
export const MOVE_PAN_SHARE = 0.02
/** a zoom past this share, */
export const MOVE_ZOOM_SHARE = 0.03
/** and a turn past this many radians (3 degrees). A viewport change counts too. */
export const MOVE_TURN_RAD = (3 * Math.PI) / 180

/** Whether the view moved enough since the last choice (`chosenAt`) for the set to differ: a pan, zoom, turn or resize. Allocation-free. */
export function viewMovedEnough(chosenAt: ViewPose, now: ViewPose): boolean {
  return differs(chosenAt, now, MOVE_PAN_SHARE, MOVE_ZOOM_SHARE, MOVE_TURN_RAD)
}

/** The camera's distance zone: 0 inside REVEAL_FAR, 1 up to the keep distance, 2 beyond. */
export function gateZone(distance: number): 0 | 1 | 2 {
  return distance < REVEAL_FAR ? 0 : distance < REVEAL_FAR * GATE_KEEP_FACTOR ? 1 : 2
}

/** The groups' member points in flat typed arrays: group i's members are x/z[start[i] .. start[i + 1]). */
export interface ViewStationSpace {
  /** One id per group (the lead's). */
  ids: readonly StationId[]
  start: Int32Array
  x: Float64Array
  z: Float64Array
  /** Every group's lead id to its index. */
  indexOf: ReadonlyMap<StationId, number>
}

export function viewStationSpace(groups: readonly StationGroup[], stationById: ReadonlyMap<StationId, { pos: Ground }>): ViewStationSpace {
  const start = new Int32Array(groups.length + 1)
  const xs: number[] = []
  const zs: number[] = []
  const indexOf = new Map<StationId, number>()
  groups.forEach((g, i) => {
    indexOf.set(g.id, i)
    for (const id of g.memberIds) {
      const pos = id === g.id ? g.pos : stationById.get(id)?.pos
      if (!pos) throw new Error(`Station group ${g.id} lists member ${id}, which the network lacks`)
      xs.push(pos.x)
      zs.push(pos.z)
    }
    start[i + 1] = xs.length
  })
  return { ids: groups.map((g) => g.id), start, x: Float64Array.from(xs), z: Float64Array.from(zs), indexOf }
}

export interface ViewQuery {
  /** Camera to orbit target, meters. */
  distance: number
  /** The orbit target on the ground. */
  tx: number
  tz: number
  free: ScreenRect
  toScreen: ToScreen
  /** The focused group's index, or -1. */
  focused: number
  /** The last choice's group indices; the first `previousCount` count. */
  previous: Int32Array
  previousCount: number
}

export interface ViewScratch {
  /** Per group: 1 while it is in `previous` (set and cleared inside one call). */
  was: Uint8Array
  /** The ranked list's scores, parallel to its slots in `out`. */
  score: Float64Array
  pt: ScreenPoint
}

export function newViewScratch(space: ViewStationSpace): ViewScratch {
  return { was: new Uint8Array(space.ids.length), score: new Float64Array(MAX_VIEW_STATIONS), pt: { x: 0, y: 0 } }
}

/** The nearest qualifying member's distance to (mx, my) px, or Infinity when no member qualifies. */
function groupScore(
  space: ViewStationSpace,
  g: number,
  q: ViewQuery,
  s: ViewScratch,
  was: boolean,
  mx: number,
  my: number,
): number {
  const { free } = q
  // A previous pick gets the free rect padded out on every side.
  const padX = was ? KEEP_PAD_SHARE * (free.right - free.left) : 0
  const padY = was ? KEEP_PAD_SHARE * (free.bottom - free.top) : 0
  const reach = REACH_SHARE * q.distance * (was ? KEEP_REACH_FACTOR : 1)
  let best = Infinity
  for (let m = space.start[g]!; m < space.start[g + 1]!; m++) {
    const x = space.x[m]!
    const z = space.z[m]!
    // Past the reach before projecting: a point near or behind the horizon never gets that far.
    if (Math.hypot(x - q.tx, z - q.tz) > reach) continue
    if (!q.toScreen(x, 0, z, s.pt)) continue
    if (s.pt.x < free.left - padX || s.pt.x > free.right + padX || s.pt.y < free.top - padY || s.pt.y > free.bottom + padY) continue
    const d = Math.hypot(s.pt.x - mx, s.pt.y - my)
    if (d < best) best = d
  }
  return best
}

/**
 * Writes the chosen group indices to `out[0..n)` (at least MAX_VIEW_STATIONS long) in rank order, the focused one
 * first, and returns n; 0 from REVEAL_FAR out, except that a previous non-empty set stays (only its own members, nothing
 * new) out to REVEAL_FAR x GATE_KEEP_FACTOR. Allocates nothing; leaves `s` clean.
 */
export function chooseViewStations(space: ViewStationSpace, q: ViewQuery, s: ViewScratch, out: Int32Array): number {
  const zone = gateZone(q.distance)
  if (zone === 2 || (zone === 1 && q.previousCount === 0)) return 0
  const keepOnly = zone === 1
  const { free } = q
  const w = free.right - free.left
  const h = free.bottom - free.top
  const mx = (free.left + free.right) / 2
  const my = (free.top + free.bottom) / 2
  const bonus = (KEEP_RANK_SHARE * Math.hypot(w, h)) / 2
  for (let i = 0; i < q.previousCount; i++) s.was[q.previous[i]!] = 1

  const head = q.focused >= 0 && (!keepOnly || s.was[q.focused] === 1) ? 1 : 0
  const slots = MAX_VIEW_STATIONS - head
  let n = 0
  for (let g = 0; g < space.ids.length; g++) {
    if (g === q.focused) continue
    const was = s.was[g] === 1
    if (keepOnly && !was) continue
    const d = groupScore(space, g, q, s, was, mx, my)
    if (d === Infinity) continue
    const sc = was ? d - bonus : d
    // Insert after every score not above it, so ties keep the lower group index first.
    let at = n
    while (at > 0 && s.score[at - 1]! > sc) at--
    if (at >= slots) continue
    const last = n < slots ? n : slots - 1
    for (let i = last; i > at; i--) {
      s.score[i] = s.score[i - 1]!
      out[head + i] = out[head + i - 1]!
    }
    s.score[at] = sc
    out[head + at] = g
    if (n < slots) n++
  }
  if (head === 1) out[0] = q.focused
  for (let i = 0; i < q.previousCount; i++) s.was[q.previous[i]!] = 0
  return head + n
}

/**
 * Whether two choices hold the same groups: with `firstMatters` (a focused station leads the list) the first slot
 * must match too, the rest in any order. At most MAX_VIEW_STATIONS each, so the nested loop is cheap.
 */
export function sameMembers(a: Int32Array, an: number, b: Int32Array, bn: number, firstMatters = true): boolean {
  if (an !== bn) return false
  if (firstMatters && an > 0 && a[0] !== b[0]) return false
  for (let i = 0; i < an; i++) {
    let found = false
    for (let j = 0; j < bn; j++) {
      if (a[i] === b[j]) {
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}
