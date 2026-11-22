/** What the trip panel says about the way out at the To station: which journeys end on a train, and the exit line's
 *  text, its dim note and the sentence a screen reader hears. Pure. */
import type { StopId } from '../data/schema'
import type { StationInterior } from '../data/stationSchema'
import type { StationStreets } from '../data/streetSchema'
import { STREET_MATCH_M, streetEntranceIndex, walkMinutes, type ExitChoice } from './exitChoice'
import { interiorBounds } from './interiorFraming'
import { MERGE_M, type EntranceText } from './entranceText'
import { toGround } from './projection'
import type { TripJourney } from './route/plan'

/** A stop some journeys get off their last train at, and the trips they ride there (in journey order). */
export interface FinalRideStop {
  stopId: StopId
  tripIds: string[]
}

/** The distinct stops of the journeys whose last leg is a ride, in journey order. A journey that ends on foot has none. */
export function finalRideStops(journeys: readonly TripJourney[]): FinalRideStop[] {
  const out: FinalRideStop[] = []
  for (const j of journeys) {
    const last = j.legs.at(-1)
    if (last?.kind !== 'ride') continue
    const at = out.find((s) => s.stopId === last.alightStop)
    if (at) {
      if (!at.tripIds.includes(last.tripId)) at.tripIds.push(last.tripId)
    } else out.push({ stopId: last.alightStop, tripIds: [last.tripId] })
  }
  return out
}

export interface ExitLineView {
  /** The map's label for the exit, which the street labels place first; null when the line names none. */
  mapLabel: ExitLabel | null
  text: string
  /** The dim line under it, parts joined " · "; null when there is nothing to add. */
  note: string | null
  spoken: string
}

const COMPASS8 = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const

/** "the northeast": which way the exit lies from the interior's plan center (x east, z south). */
function compassOf(interior: StationInterior, point: readonly [number, number]): string {
  const b = interiorBounds(interior)
  const angle = Math.atan2(point[1] - (b.minZ + b.maxZ) / 2, point[0] - (b.minX + b.maxX) / 2)
  return `the ${COMPASS8[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]!}`
}

/** One street file and its entrance labels (entranceText.ts). */
export interface StreetSource {
  file: StationStreets
  labels: readonly EntranceText[]
}

/** Which map label names the exit: the street file's station and a file entrance index among the label's `members`. */
export interface ExitLabel {
  stationId: string
  index: number
}

/**
 * The street label for the exit, from the first source with a file entrance at the exit (the label it is a member of:
 * its own, or the same-text twin it merged into), else the nearest label of the same kind within MERGE_M in any source.
 * A complex passes its file's streets and the alighting member's.
 */
/** A label found for the exit, its file's station and the exit's own file entrance index (one of its `members`). */
interface Found extends ExitLabel {
  label: EntranceText
}

function labelOf(choice: ExitChoice, interior: StationInterior, sources: readonly StreetSource[]): Found | null {
  if (choice.exit.entranceId === null) return null
  const origin = toGround(interior.anchor)
  const scene = { x: origin.x + choice.exit.point[0], z: origin.z + choice.exit.point[1] }
  const elevator = choice.exit.type === 'Elevator'
  let best: Found | null = null
  let bestD = MERGE_M + STREET_MATCH_M
  for (const { file, labels } of sources) {
    const i = streetEntranceIndex(scene, choice.exit.type, file)
    // A same-text twin merged into another label is one of that label's members.
    const own = i === null ? undefined : labels.find((l) => l.members.includes(i))
    if (own) return { label: own, stationId: file.stationId, index: i! }
    const fileOrigin = toGround(file.anchor)
    const [x, z] = [scene.x - fileOrigin.x, scene.z - fileOrigin.z]
    for (const l of labels) {
      const d = Math.hypot(l.x - x, l.z - z)
      if (l.elevator === elevator && d <= bestD) [best, bestD] = [{ label: l, stationId: file.stationId, index: l.index }, d]
    }
  }
  return best
}

/** The machine kinds the route rides, in a fixed order. */
function machinesUsed(choice: ExitChoice, interior: StationInterior): ('elevator' | 'escalator')[] {
  const kinds = new Set(choice.connectorIds.map((id) => interior.connectors.find((c) => c.id === id)?.kind))
  return (['elevator', 'escalator'] as const).filter((k) => kinds.has(k))
}

/**
 * The trip panel's exit line. "Quickest way out: Bedford Av & N 7 St" for the quickest way out (no destination), "Exit
 * at …" toward a point; with no street label, the way from the station's middle ("toward the northeast"). The note
 * holds the label's tail, "probably" on an estimated layout, the walk on, and "elevator status unknown" (or
 * escalator) when the route rides one and the station panel would call machine status unknown (`closedKnown` false).
 */
export function exitLineView(
  choice: ExitChoice,
  interior: StationInterior,
  sources: readonly StreetSource[],
  closedKnown: boolean,
): ExitLineView {
  const found = labelOf(choice, interior, sources)
  const label = found?.label ?? null
  const head = label ? label.head : `toward ${compassOf(interior, choice.exit.point)}`
  const lead = choice.destination === null ? 'Quickest way out:' : label ? 'Exit at' : 'Exit'
  const unknown = closedKnown ? [] : machinesUsed(choice, interior)
  const status = unknown.length > 0 ? `${unknown.join(' and ')} status unknown` : null
  const walk = choice.walk
  const minutes = walk && walkMinutes(walk.seconds)
  const walkText = walk === null ? null : walk.kind === 'route' ? `then ${minutes} min walk` : `about ${minutes} min walk`
  const tail = label && label.tail !== '' ? label.tail : null
  const note = [tail, choice.probable ? 'probably' : null, walkText, status].filter((p): p is string => p !== null)
  const sentences = [`${lead} ${streetSpoken(head)}${tail ? `, ${streetSpoken(tail.replaceAll(' · ', ', '))}` : ''}.`]
  if (walk) sentences.push(`${walk.kind === 'route' ? 'Then a' : 'About a'} ${minutes} minute walk.`)
  if (status) sentences.push(`${capitalize(status)}.`)
  if (choice.probable) sentences.push('Probably: the station layout is estimated.')
  const mapLabel = found && { stationId: found.stationId, index: found.index }
  return { mapLabel, text: `${lead} ${head}`, note: note.length > 0 ? note.join(' · ') : null, spoken: sentences.join(' ') }
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const TYPE_SPOKEN: Readonly<Record<string, string>> = {
  Av: 'Avenue',
  St: 'Street',
  Blvd: 'Boulevard',
  Pkwy: 'Parkway',
  Pl: 'Place',
  Rd: 'Road',
  Sq: 'Square',
  Ln: 'Lane',
  Dr: 'Drive',
  Ct: 'Court',
  Ter: 'Terrace',
  Hwy: 'Highway',
  Expy: 'Expressway',
  Ext: 'Extension',
}
const COMPASS_SPOKEN: Readonly<Record<string, string>> = { N: 'North', S: 'South', E: 'East', W: 'West' }
const CORNER_SPOKEN: Readonly<Record<string, string>> = { NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest' }
const NAME_WORD = /^([0-9]|[A-Z])/

/**
 * A sign-style street label as a screen reader should say it: type words in full ("W 96 St" → "West 96 Street",
 * "St" as "Saint" when it opens a name), a compass letter before a number or name ("N 7 St" → "North 7 Street") or
 * closing one ("Park Av S", "Central Park W"; not a lettered avenue, "Av S"), corners in full ("NE" → "northeast") and "&" as "and".
 */
export function streetSpoken(text: string): string {
  const words = text.split(' ')
  return words
    .map((w, i) => {
      const prev = words[i - 1]
      const next = words[i + 1]
      // A name opens at the start or after a joining word ("&", "at", "of"...).
      const opens = prev === undefined || !NAME_WORD.test(prev)
      if (w === '&') return 'and'
      if (CORNER_SPOKEN[w]) return CORNER_SPOKEN[w]
      if (w === 'St' && opens && next !== undefined && NAME_WORD.test(next)) return 'Saint'
      if (TYPE_SPOKEN[w]) return TYPE_SPOKEN[w]
      if (COMPASS_SPOKEN[w]) {
        if (opens && next !== undefined && NAME_WORD.test(next)) return COMPASS_SPOKEN[w]
        // Closing a name ("Park Av S", "Central Park W"), but not the letter of a lettered avenue ("Av S").
        const prevOpens = i < 2 || !NAME_WORD.test(words[i - 2]!)
        const lettered = prev !== undefined && TYPE_SPOKEN[prev] !== undefined && prevOpens
        const closesName = prev !== undefined && NAME_WORD.test(prev) && !lettered
        if (closesName && (next === undefined || !NAME_WORD.test(next))) return COMPASS_SPOKEN[w]
      }
      return w
    })
    .join(' ')
}
