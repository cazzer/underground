/** What the trip panel says about a change of trains inside a complex: which legs are changes, and the transfer line's
 *  text, its dim note, the step-free line and the sentence a screen reader hears. Pure. */
import type { RouteId, StopId } from '../data/schema'
import type { Connector, StationInterior } from '../data/stationSchema'
import { machinesUsed } from './exitView'
import { endpointArea } from './interiorGraph'
import type { TransferChoice, TransferRoute } from './interiorTransfer'
import { routeSpokenName } from './labels'
import type { TripJourney, TripLeg } from './route/plan'

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

/** Every walk leg between two rides, in journey order, each key once. */
export function transferLegs(journeys: readonly TripJourney[]): TransferLeg[] {
  const out = new Map<string, TransferLeg>()
  for (const j of journeys) {
    j.legs.forEach((leg: TripLeg, i) => {
      const [prev, next] = [j.legs[i - 1], j.legs[i + 1]]
      if (leg.kind !== 'walk' || prev?.kind !== 'ride' || next?.kind !== 'ride') return
      const key = transferLegKey(leg, next)
      if (!out.has(key)) out.set(key, { key, fromStop: leg.fromStop, toStop: leg.toStop, nextRouteId: next.routeId })
    })
  }
  return [...out.values()]
}

export interface TransferLineView {
  /** "Stairs up to the N platform". */
  text: string
  /** The dim line under it ("probably", a machine whose status is unknown), parts joined " · "; null for none. */
  note: string | null
  /** "Step-free: elevators via the Lexington mezzanine and the Broadway mezzanine"; null when no step-free way is
   *  offered (the quickest is step-free already, or there is none). */
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

/** One step per connector, in travel order, consecutive ones of the same kind and way merged into the last. */
function stepsOf(route: Pick<TransferRoute, 'connectorIds' | 'areaIds'>, interior: StationInterior, routeName: string): Step[] {
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y]))
  const steps: Step[] = []
  route.connectorIds.forEach((id, i) => {
    const c = interior.connectors.find((k) => k.id === id)
    if (!c) throw new Error(`Transfer at ${interior.stationId}: no connector "${id}"`)
    const arrival = route.areaIds[i + 1]
    const [arrive, leave] = endpointArea(interior, c.upper) === arrival ? [c.upper, c.lower] : [c.lower, c.upper]
    const way = c.kind === 'walkway' ? '' : levelY.get(arrive.level)! > levelY.get(leave.level)! ? ' up' : ' down'
    const head = `${KIND_TEXT[c.kind]}${way}`
    const last = i === route.connectorIds.length - 1
    const slab = interior.slabs.find((s) => s.id === arrival)
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

/** "Step-free: elevators via the Lexington mezzanine and the Broadway mezzanine". */
function stepFreeText(alt: TransferRoute, interior: StationInterior): string {
  const elevators = alt.connectorIds.filter((id) => interior.connectors.find((c) => c.id === id)?.kind === 'elevator').length
  const slabs = alt.areaIds.flatMap((id) => interior.slabs.filter((s) => s.id === id).map((s) => `the ${s.name}`))
  const how = [elevators === 0 ? null : elevators === 1 ? 'elevator' : 'elevators', slabs.length > 0 ? `via ${slabs.join(' and ')}` : null]
  const said = how.filter((p): p is string => p !== null)
  return said.length > 0 ? `Step-free: ${said.join(' ')}` : 'Step-free'
}

/**
 * The trip panel's transfer line, under its "Change at …" row: each connector in travel order and where it arrives
 * (the next train's platform by its route), the note ("probably" on an estimated layout or an assumed fare control,
 * "elevator status unknown" when the station panel would call machine status unknown and a route offered rides
 * one), and the step-free way when the quickest one has steps.
 */
export function transferLineView(choice: TransferChoice, interior: StationInterior, toRouteName: string, closedKnown: boolean): TransferLineView {
  const steps = stepsOf(choice, interior, toRouteName)
  const text = steps.length === 0 ? 'Across the platform' : capitalize(steps.map((s) => `${s.head} to ${s.to}`).join(', then '))
  const spokenRoute = steps.length === 0 ? 'Across the platform.' : `Take ${steps.map((s) => `${spokenHead(s)} to ${s.toSpoken}`).join(', then ')}.`
  const rides = [...choice.connectorIds, ...(choice.stepFreeAlt?.connectorIds ?? [])]
  const unknown = closedKnown ? [] : machinesUsed({ connectorIds: rides }, interior)
  const status = unknown.length > 0 ? `${unknown.join(' and ')} status unknown` : null
  const note = [choice.probable ? 'probably' : null, status].filter((p): p is string => p !== null)
  const stepFree = choice.stepFreeAlt ? stepFreeText(choice.stepFreeAlt, interior) : null
  const estimated = interior.generated !== undefined || interior.approximate === true
  const sentences = [spokenRoute]
  if (choice.probable) sentences.push(estimated ? 'Probably: the station layout is estimated.' : 'Probably: fare control is assumed.')
  if (status) sentences.push(`${capitalize(status)}.`)
  if (stepFree) sentences.push(`${stepFree}.`)
  return { text, note: note.length > 0 ? note.join(' · ') : null, stepFree, spoken: sentences.join(' ') }
}
