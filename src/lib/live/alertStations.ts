import { searchTokens } from '../../../worker/src/searchText'
import type { AlertPeriod, ServiceAlert } from '../../data/realtime'
import type { Direction, RouteId, StationId } from '../../data/schema'
import type { Station } from '../network'

export type AlertKind = 'skip' | 'part' | 'suspended' | 'other'

/**
 * What an alert does to service, from the MTA's free-text `alert_type` ("Planned - Stops Skipped", "Planned - Part
 * Suspended", "Planned - Suspended", "Delays", "Station Notice", ...). Anything we don't recognise is `other`: listed
 * with the MTA's header and no claim of our own.
 */
export function alertKindOf(type: string | null): AlertKind {
  if (type === null) return 'other'
  if (/stops? skipped/i.test(type)) return 'skip'
  if (/part suspended/i.test(type)) return 'part'
  if (/\bsuspended\b/i.test(type)) return 'suspended'
  return 'other'
}

/**
 * The words of a header that name the stations a skip is about: after the first "skip"/"skips" up to the first line
 * break, ";", ". ", " due to ", " for " or " while ". The stretch that follows, "Woodside-61 St" on a second line or
 * "the Thanksgiving Day Parade", is never read as a station. A header with no "skip" ("runs express from A to B")
 * names nothing: its two stations are the ends of the stretch, not skipped ones, so the empty clause sends the
 * caller to the informed stops.
 */
export function skipClause(header: string): string {
  const m = /\bskips?\b/i.exec(header)
  if (!m) return ''
  const after = header.slice(m.index + m[0].length)
  const cut = after.search(/\n|;|\. | due to | for | while /i)
  return cut === -1 ? after : after.slice(0, cut)
}

const canonTokens = (text: string): string[] => searchTokens(text).map((t) => t.canon)

/** The clause's items, split on ",", "&" and "and": each is one station name, maybe with words after it ("in both directions"). */
function clauseItems(clause: string): string[][] {
  return clause.split(/,|&|\band\b/i).map(canonTokens).filter((t) => t.length > 0)
}

const startsWith = (item: readonly string[], form: readonly string[]): boolean => form.every((t, i) => item[i] === t)

/** A station name and its parts: split on "-", "/" and parentheses ("Times Sq-42 St" is also "Times Sq" and "42 St"). */
function nameForms(name: string): string[][] {
  return [name, ...name.split(/[-/()]/)].map(canonTokens).filter((t) => t.length > 0)
}

/**
 * The candidates the header names: some item of the clause is the whole name, or one of its parts, or starts with it
 * (so "81 St-Museum of Natural History in both directions" and a trailing "- Take the A" still match). Whole words,
 * from the item's start: "25 St" is not "125 St", and "4 Av-9 St" does not name Smith-9 Sts nor "3 Av-149 St"
 * 149 St-Hostos. "Av" and "Avenue", "Ft" and "Fort" are the same word.
 */
export function headerNamedStations(header: string, candidates: readonly { id: StationId; name: string }[]): Set<StationId> {
  const items = clauseItems(skipClause(header))
  return new Set(candidates.filter((c) => nameForms(c.name).some((form) => items.some((item) => startsWith(item, form)))).map((c) => c.id))
}

/**
 * The two stations farthest apart: the ends of a stretch whose stations are listed in no order. One station gives
 * itself twice.
 */
export function stretchEnds(ids: readonly StationId[], posOf: (id: StationId) => { x: number; z: number }): [StationId, StationId] {
  let best: [StationId, StationId] = [ids[0]!, ids[0]!]
  let bestD = -1
  for (let i = 0; i < ids.length; i++) {
    const a = posOf(ids[i]!)
    for (let j = i + 1; j < ids.length; j++) {
      const b = posOf(ids[j]!)
      const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2
      if (d > bestD) {
        bestD = d
        best = [ids[i]!, ids[j]!]
      }
    }
  }
  return best
}

/** The stations of one route that a skip alert says trains pass without stopping, and how sure we are. */
export interface RouteSkipSet {
  alertId: string
  route: RouteId
  /** The direction every informed stop shares, else null (both, or mixed). */
  direction: Direction | null
  stations: ReadonlySet<StationId>
  /** True when the header named none of the informed stations, so the set is our guess (informed minus the stretch's ends). */
  probable: boolean
  periods: readonly AlertPeriod[]
}

/** The one direction every entity shares, else null. */
export function sharedDirection(directions: readonly (Direction | null)[]): Direction | null {
  const first = directions[0]
  return first !== null && first !== undefined && directions.every((d) => d === first) ? first : null
}

/**
 * Per route of a skip alert (none for any other kind) that has informed stops: the stations skipped. The informed
 * stops are the MTA's list for the route, and its header says which of them are skipped; the stations the header
 * names, out of the informed ones, are the set. When it names none (a wording we can't read), the set is a guess,
 * `probable`: every informed station when there are two or fewer, else all but the two ends of the stretch (the
 * listed stops usually bracket the skipped ones). A stop `stationById` lacks is ignored; an empty set is omitted.
 */
export function skipSetsOf(alert: ServiceAlert, stationById: ReadonlyMap<StationId, Station>): RouteSkipSet[] {
  if (alertKindOf(alert.type) !== 'skip') return []
  const routes = [...new Set(alert.entities.filter((e) => e.stop !== null).map((e) => e.route))]
  const sets: RouteSkipSet[] = []
  for (const route of routes) {
    const entities = alert.entities.filter((e) => e.route === route && e.stop !== null && stationById.has(e.stop))
    const informed = [...new Set(entities.map((e) => e.stop!))]
    const named = headerNamedStations(alert.header, informed.map((id) => ({ id, name: stationById.get(id)!.name })))
    let stations: ReadonlySet<StationId>
    let probable = false
    if (named.size > 0) {
      stations = named
    } else {
      probable = true
      const ends: StationId[] = informed.length <= 2 ? [] : stretchEnds(informed, (id) => stationById.get(id)!.pos)
      stations = new Set(informed.filter((id) => !ends.includes(id)))
    }
    if (stations.size === 0) continue
    sets.push({ alertId: alert.id, route, direction: sharedDirection(entities.map((e) => e.direction)), stations, probable, periods: alert.periods })
  }
  return sets
}
