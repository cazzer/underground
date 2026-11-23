/** What the trip panel says about a change of trains inside a complex: which legs are changes, which one each interior
 *  draws, and the transfer line's text, its dim note, the step-free line and the sentence a screen reader hears. Pure. */
import type { RouteId, StationId, StopId } from '../data/schema'
import type { Connector, StationInterior } from '../data/stationSchema'
import { machinesUsed } from './exitView'
import { endpointArea } from './interiorGraph'
import type { StationPathDraw } from './interiorPath'
import type { TransferChoice, TransferRoute } from './interiorTransfer'
import { routeSpokenName } from './labels'
import { stationOfStop } from './live/arrivals'
import type { TripJourney } from './route/plan'

/** A walk between two rides: the change, the stops either side and the route the rider changes to. */
export interface TransferLeg {
  key: string
  fromStop: StopId
  toStop: StopId
  nextRouteId: RouteId
}

/** Keys a change by its stops and the next route: the N and the Q both leave from R20N, and the line names the route. */
export function transferLegKey(walk: { fromStop: StopId; toStop: StopId }, nextRide: { routeId: RouteId }): string {
  return `${walk.fromStop}>${walk.toStop}>${nextRide.routeId}`
}

/** A walk between two rides that the panel calls a change: within one station, or between two stations of one name
 *  (the platforms of a complex). */
export function isChangeWalk(walk: { fromStop: StopId; toStop: StopId; sameStation: boolean }, stationName: (id: StationId) => string): boolean {
  return walk.sameStation || stationName(stationOfStop(walk.fromStop)) === stationName(stationOfStop(walk.toStop))
}

/** Every change row (a change walk between two rides), in journey order, each key once. */
export function transferLegs(journeys: readonly TripJourney[], stationName: (id: StationId) => string): TransferLeg[] {
  const out = new Map<string, TransferLeg>()
  for (const j of journeys) {
    j.legs.forEach((leg, i) => {
      const [prev, next] = [j.legs[i - 1], j.legs[i + 1]]
      if (leg.kind !== 'walk' || prev?.kind !== 'ride' || next?.kind !== 'ride' || !isChangeWalk(leg, stationName)) return
      const key = transferLegKey(leg, next)
      if (!out.has(key)) out.set(key, { key, fromStop: leg.fromStop, toStop: leg.toStop, nextRouteId: next.routeId })
    })
  }
  return [...out.values()]
}

/**
 * The transfer paths the map draws for one journey: `keys` are that journey's change keys (`transferLegs([journey])`);
 * per interior, the first of its changes there, in `legs` order. None for an interior when that change takes no
 * connector (across one platform) or found no route; legs of other journeys never draw.
 */
export function journeyTransferDraws<L extends { file: string; key: string }>(
  legs: readonly L[],
  keys: ReadonlySet<string>,
  choiceOf: (leg: L) => TransferChoice | null,
): StationPathDraw[] {
  const decided = new Set<string>()
  const out: StationPathDraw[] = []
  for (const leg of legs) {
    if (!keys.has(leg.key) || decided.has(leg.file)) continue
    decided.add(leg.file)
    const choice = choiceOf(leg)
    if (choice && choice.connectorIds.length > 0) out.push({ interiorId: leg.file, choice })
  }
  return out
}

export interface TransferLineView {
  /** "Stairs up to the N platform". */
  text: string
  /** The way is probable (an estimated layout, or an assumed fare control): a dim "· probably" after `text`. */
  probably: boolean
  /** The dim line under it ("elevator status unknown"); null for none. */
  note: string | null
  /** "Step-free: elevators via the Lexington mezzanine and the Broadway mezzanine" (with "· probably" when that way is
   *  probable), or "No step-free way" when the layout has none; null when the quickest is step-free, or an outage took
   *  the step-free way away. */
  stepFree: string | null
  spoken: string
}

const KIND_TEXT: Record<Connector['kind'], string> = { stair: 'stairs', escalator: 'escalator', elevator: 'elevator', ramp: 'ramp', walkway: 'the passageway' }

interface Step {
  /** "stairs up", "the passageway". */
  head: string
  kind: Connector['kind']
  /** "the N platform". */
  to: string
  toSpoken: string
}

/**
 * One step per connector, in travel order, consecutive ones of the same kind and way merged into the last. Each leaves
 * by its end in the area the walk stands in (from the alighting platform on) and arrives where its other end stands.
 */
function stepsOf(route: Pick<TransferRoute, 'connectorIds' | 'areaIds'>, interior: StationInterior, routeName: string): Step[] {
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y]))
  const steps: Step[] = []
  let area: string | null = route.areaIds[0] ?? null
  route.connectorIds.forEach((id, i) => {
    const c = interior.connectors.find((k) => k.id === id)
    if (!c) throw new Error(`Transfer at ${interior.stationId}: no connector "${id}"`)
    const lowerHere = endpointArea(interior, c.lower) === area
    if (!lowerHere && endpointArea(interior, c.upper) !== area) throw new Error(`Transfer at ${interior.stationId}: connector ${id} has no end in ${area}`)
    const [leave, arrive] = lowerHere ? [c.lower, c.upper] : [c.upper, c.lower]
    area = endpointArea(interior, arrive)
    const way = c.kind === 'walkway' ? '' : levelY.get(arrive.level)! > levelY.get(leave.level)! ? ' up' : ' down'
    const head = `${KIND_TEXT[c.kind]}${way}`
    const last = i === route.connectorIds.length - 1
    const slab = interior.slabs.find((s) => s.id === area)
    const to = last ? `the ${routeName} platform` : slab ? `the ${slab.name}` : 'another platform'
    const toSpoken = last ? `the ${routeSpokenName(routeName)} platform` : to
    const prev = steps.at(-1)
    if (prev && prev.head === head) steps[steps.length - 1] = { ...prev, to, toSpoken }
    else steps.push({ head, kind: c.kind, to, toSpoken })
  })
  return steps
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const spokenHead = (s: Step): string => (s.kind === 'walkway' ? s.head : `the ${s.head}`)

/** "elevators via the Lexington mezzanine and the Broadway mezzanine"; empty when it names nothing. */
function stepFreeWay(alt: TransferRoute, interior: StationInterior): string {
  const elevators = alt.connectorIds.filter((id) => interior.connectors.find((c) => c.id === id)?.kind === 'elevator').length
  const slabs = alt.areaIds.flatMap((id) => interior.slabs.filter((s) => s.id === id).map((s) => `the ${s.name}`))
  const how = [elevators === 0 ? null : elevators === 1 ? 'elevator' : 'elevators', slabs.length > 0 ? `via ${slabs.join(' and ')}` : null]
  return how.filter((p): p is string => p !== null).join(' ')
}

/**
 * The trip panel's transfer line, under its "Change at …" row: each connector in travel order and where it arrives
 * (the next train's platform by its route), "probably" on an estimated layout or an assumed fare control, the note
 * ("elevator status unknown" when the station panel would call machine status unknown and a route offered rides one),
 * and the step-free way when the quickest one has steps ("No step-free way" when the layout has none; nothing when an
 * outage took it away).
 */
export function transferLineView(choice: TransferChoice, interior: StationInterior, toRouteName: string, closedKnown: boolean): TransferLineView {
  const steps = stepsOf(choice, interior, toRouteName)
  const across = choice.stopId === choice.toStopId ? 'Same platform' : 'Across the platform'
  const text = steps.length === 0 ? across : capitalize(steps.map((s) => `${s.head} to ${s.to}`).join(', then '))
  const spokenRoute = steps.length === 0 ? `${across}.` : `Take ${steps.map((s) => `${spokenHead(s)} to ${s.toSpoken}`).join(', then ')}.`
  const alt = choice.stepFreeAlt
  const rides = [...choice.connectorIds, ...(alt?.connectorIds ?? [])]
  const unknown = closedKnown ? [] : machinesUsed({ connectorIds: rides }, interior)
  const status = unknown.length > 0 ? `${unknown.join(' and ')} status unknown` : null
  const estimated = interior.generated !== undefined || interior.approximate === true
  const altProbable = alt !== null && (estimated || alt.paidAssumed)
  const way = alt ? stepFreeWay(alt, interior) : ''
  const altText = alt ? `Step-free${way === '' ? '' : `: ${way}`}${altProbable ? ' · probably' : ''}` : null
  const stepFree = altText ?? (choice.noStepFree === 'layout' ? 'No step-free way' : null)
  const sentences = [spokenRoute]
  if (choice.probable) sentences.push(estimated ? 'Probably: the station layout is estimated.' : 'Probably: fare control is assumed.')
  if (status) sentences.push(`${capitalize(status)}.`)
  if (alt) sentences.push(`Step-free${way === '' ? '' : `: ${way}`}${altProbable ? ', probably' : ''}.`)
  else if (choice.noStepFree === 'layout') sentences.push('No step-free way in this layout.')
  return { text, probably: choice.probable, note: status, stepFree, spoken: sentences.join(' ') }
}
