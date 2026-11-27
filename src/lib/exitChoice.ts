/**
 * Which exit to take: for a destination and the stop a rider gets off at, the street exit that minimizes the walk
 * inside the station (platform to street, `routesToStreet`) plus the walk outside it (the station's walk shard when
 * the destination is within its radius, else a straight-line estimate: outsideWalk.ts). And the quickest way in where a
 * rider boards (`quickestEntry`), or in from a point (`chooseEntry`: the same walk run the other way). Pure; every
 * input is passed in.
 */
import type { StationId, StopId } from '../data/schema'
import type { StationInterior } from '../data/stationSchema'
import type { StationStreets, StreetJoin } from '../data/streetSchema'
import type { WalkGraph } from '../data/walkSchema'
import { routesFromStreet, routesToStreet, type InStationRoute } from './interiorGraph'
import { toGround, type Ground } from './projection'
import { chooseOutside, type ExitWalk } from './outsideWalk'

/** An interior entrance and a street-file entrance are one when within this many meters (and of one type). */
export const STREET_MATCH_M = 1.5

export interface ExitChoiceInput {
  interior: StationInterior
  /** The child stop the rider gets off at, e.g. "L08N". */
  stopId: StopId
  /** Scene ground. */
  destination: Ground
  /** The station's walk graph, once loaded; null to estimate. */
  walk: WalkGraph | null
  /** The station's street file, for the exit's street name and side. */
  streets?: StationStreets | null
  stepFree?: boolean
  /** Connector ids out of service. */
  closed?: ReadonlySet<string>
}

export interface ExitChoice extends Omit<InStationRoute, 'seconds'> {
  kind: 'exit'
  stationId: StationId
  stopId: StopId
  /** The interior is an estimate (generated, or authored and marked `approximate`), so the exit and its path are
   *  probable rather than known. */
  probable: boolean
  stepFree: boolean
  /** The street and side of the exit, from the street file's entrance at the same place; null when none matches. */
  street: StreetJoin | null
  /** Seconds from the track to the street. The walk along the platform to the car is not costed (the rider is assumed to board the car nearest the exit), so on a long platform this understates. */
  inStationS: number
  /** The walk outside to `destination`; null for the quickest way out (no destination). */
  walk: ExitWalk | null
  /** Scene ground the rider is heading for; null for the quickest way out. */
  destination: Ground | null
  totalS: number
}

export type ExitResult = ExitChoice | { kind: 'none'; reason: 'no-track' | 'no-exit' }

/**
 * The quickest way in for a rider boarding at `stopId`: the exit's shape read the other way. `exit` is the entry the
 * rider comes in by, `connectorIds` and `areaIds` still run platform to street (against travel), `inStationS` is the
 * time from the street to the track, and the walk outside exists only for `chooseEntry` (from a point).
 */
export interface BoardChoice extends Omit<ExitChoice, 'kind' | 'walk' | 'destination'> {
  kind: 'board'
  /** The walk outside from `origin` to the entrance, points running origin to entrance; null for the quickest way in. */
  walk: ExitWalk | null
  destination: null
  /** Scene ground the rider comes from (a searched place; never the location fix); null for the quickest way in. */
  origin: Ground | null
}

export type BoardResult = BoardChoice | { kind: 'none'; reason: 'no-track' | 'no-entrance' }

/** Whole minutes to show for a walk: at least 1. */
export function walkMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

/**
 * Index into the street file's entrances of the one at an exit's scene position: the nearest within `STREET_MATCH_M` of
 * the same `type`. Null for an unlisted exit (no type) or when none is near enough.
 */
export function streetEntranceIndex(exitScene: Ground, type: string | null, streets: StationStreets): number | null {
  if (type === null) return null
  const origin = toGround(streets.anchor)
  let best: number | null = null
  let bestD = STREET_MATCH_M
  streets.entrances.forEach((e, i) => {
    if (e.type !== type) return
    const d = Math.hypot(origin.x + e.x / 10 - exitScene.x, origin.z + e.z / 10 - exitScene.z)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  })
  return best
}

/** The street file's join for an exit at a scene position (`streetEntranceIndex`); null when none matches. */
export function streetJoinOf(exitScene: Ground, type: string | null, streets: StationStreets): StreetJoin | null {
  const i = streetEntranceIndex(exitScene, type, streets)
  if (i === null) return null
  const { street, wayId, cross, crossWayId, side, plaza } = streets.entrances[i]!
  return { street, wayId, cross, crossWayId, side, plaza }
}

/** The member station a child stop belongs to: a complex interior covers several. */
function stationOf(interior: StationInterior, stopId: StopId): StationId {
  const parent = /[NS]$/.test(stopId) ? stopId.slice(0, -1) : stopId
  return interior.memberStationIds?.includes(parent) ? parent : interior.stationId
}

type QuickestInput = Omit<ExitChoiceInput, 'destination' | 'walk'>

/** The chosen route as an `ExitChoice`, with its walk outside (none for the quickest way out). */
function choiceOf(input: QuickestInput, chosen: InStationRoute, outside: Pick<ExitChoice, 'walk' | 'destination' | 'totalS'>): ExitChoice {
  const { interior, stopId } = input
  const { seconds, ...route } = chosen
  const origin = toGround(interior.anchor)
  const at = { x: origin.x + route.exit.point[0], z: origin.z + route.exit.point[1] }
  return {
    ...route,
    kind: 'exit',
    stationId: stationOf(interior, stopId),
    stopId,
    probable: interior.generated !== undefined || interior.approximate === true,
    stepFree: input.stepFree === true,
    street: input.streets ? streetJoinOf(at, route.exit.type, input.streets) : null,
    inStationS: seconds,
    ...outside,
  }
}

/**
 * The best exit for a rider alighting at `stopId` and heading for `destination`. `none` when no platform track serves
 * the stop, or none of them reaches an exit (step-free with no elevator, or every way out closed).
 */
export function chooseExit(input: ExitChoiceInput): ExitResult {
  const { interior, stopId, destination, walk } = input
  const stepFree = input.stepFree === true
  const stationId = stationOf(interior, stopId)
  if (walk !== null && walk.stationId !== stationId) {
    throw new Error(`The walk graph is for station ${walk.stationId}, but stop ${stopId} is at ${stationId}`)
  }
  const routes = routesToStreet(interior, stopId, { stepFree, closed: input.closed })
  if (routes === null) return { kind: 'none', reason: 'no-track' }
  if (routes.length === 0) return { kind: 'none', reason: 'no-exit' }
  const origin = toGround(interior.anchor)
  const exitScene = routes.map((r) => ({ x: origin.x + r.exit.point[0], z: origin.z + r.exit.point[1] }))
  const outside = chooseOutside(routes, exitScene, destination, walk, stepFree)
  return choiceOf(input, outside.route, { walk: outside.walk, destination, totalS: outside.totalS })
}

/**
 * The quickest way out for a rider alighting at `stopId`, with no destination: the exit with the least time inside the
 * station (`routesToStreet`'s first). `none` as for `chooseExit`.
 */
export function quickestExit(input: QuickestInput): ExitResult {
  const routes = routesToStreet(input.interior, input.stopId, { stepFree: input.stepFree === true, closed: input.closed })
  if (routes === null) return { kind: 'none', reason: 'no-track' }
  if (routes.length === 0) return { kind: 'none', reason: 'no-exit' }
  return choiceOf(input, routes[0]!, { walk: null, destination: null, totalS: routes[0]!.seconds })
}

/**
 * The quickest way in for a rider boarding at `stopId`: the street entry with the least time inside the station to a
 * track of the stop (`routesFromStreet`'s first), one-way escalators ridden only the way they run. `none` when no
 * platform track serves the stop, or no entry reaches one (step-free with no elevator, or every way in closed).
 */
export function quickestEntry(input: QuickestInput): BoardResult {
  const routes = routesFromStreet(input.interior, input.stopId, { stepFree: input.stepFree === true, closed: input.closed })
  if (routes === null) return { kind: 'none', reason: 'no-track' }
  if (routes.length === 0) return { kind: 'none', reason: 'no-entrance' }
  const choice = choiceOf(input, routes[0]!, { walk: null, destination: null, totalS: routes[0]!.seconds })
  return { ...choice, kind: 'board', walk: null, destination: null, origin: null }
}

export interface EntryChoiceInput extends QuickestInput {
  /** Scene ground the rider comes from: a searched place. */
  origin: Ground
  /** The station's walk graph, once loaded; null to estimate. */
  walk: WalkGraph | null
}

/**
 * The best way in for a rider coming from `origin` and boarding at `stopId`: the entry minimizing the walk outside
 * (over the station's graph when the origin is within its radius, else a straight estimate) plus the time inside
 * (`routesFromStreet`). The graph is undirected, so the walk is searched entrance to origin and its points reversed to
 * run origin to entrance. `none` as for `quickestEntry`. Throws when the walk graph is another station's.
 */
export function chooseEntry(input: EntryChoiceInput): BoardResult {
  const { interior, stopId, origin, walk } = input
  const stepFree = input.stepFree === true
  const stationId = stationOf(interior, stopId)
  if (walk !== null && walk.stationId !== stationId) {
    throw new Error(`The walk graph is for station ${walk.stationId}, but stop ${stopId} is at ${stationId}`)
  }
  const routes = routesFromStreet(interior, stopId, { stepFree, closed: input.closed })
  if (routes === null) return { kind: 'none', reason: 'no-track' }
  if (routes.length === 0) return { kind: 'none', reason: 'no-entrance' }
  const at = toGround(interior.anchor)
  const entryScene = routes.map((r) => ({ x: at.x + r.exit.point[0], z: at.z + r.exit.point[1] }))
  const outside = chooseOutside(routes, entryScene, origin, walk, stepFree)
  const walkIn: ExitWalk = outside.walk.kind === 'route' ? { ...outside.walk, points: [...outside.walk.points].reverse() } : outside.walk
  const choice = choiceOf(input, outside.route, { walk: walkIn, destination: null, totalS: outside.totalS })
  return { ...choice, kind: 'board', walk: walkIn, destination: null, origin }
}
