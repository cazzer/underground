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

interface Form {
  tokens: string[]
  /** The whole name, not one of its parts. */
  whole: boolean
}

/** A station name and its parts: split on "-", "/" and parentheses ("Times Sq-42 St" is also "Times Sq" and "42 St"). */
function nameForms(name: string): Form[] {
  const forms = [{ tokens: canonTokens(name), whole: true }, ...name.split(/[-/()]/).map((part) => ({ tokens: canonTokens(part), whole: false }))]
  return forms.filter((f) => f.tokens.length > 0)
}

/**
 * The candidates each item names. An item names a candidate when it equals the whole name or one of its parts, or
 * starts with one (so "81 St-Museum of Natural History in both directions" and a trailing "- Take the A" still match);
 * whole words from the item's start ("25 St" is not "125 St"; "Av" and "Avenue", "Ft" and "Fort" are the same word).
 * Neighbours that share words don't name each other: of the candidates an item matches, only the ones whose best
 * matching form is longest (in tokens) are named, a whole name winning a tie, so "149 St-Hostos" is not "3 Av-149 St"
 * and "Sutphin Blvd" is not "Sutphin Blvd-Archer Av-JFK Airport". Candidates that still tie (stations of one name)
 * are all named.
 */
function namedIn(items: readonly (readonly string[])[], candidates: readonly { id: StationId; name: string }[]): Set<StationId> {
  const forms = candidates.map((c) => ({ id: c.id, forms: nameForms(c.name) }))
  const named = new Set<StationId>()
  for (const item of items) {
    let best = 0
    let winners: StationId[] = []
    for (const c of forms) {
      const score = Math.max(0, ...c.forms.filter((f) => startsWith(item, f.tokens)).map((f) => f.tokens.length * 2 + (f.whole ? 1 : 0)))
      if (score === 0 || score < best) continue
      if (score > best) winners = []
      best = score
      winners.push(c.id)
    }
    for (const id of winners) named.add(id)
  }
  return named
}

/**
 * The candidates the header names, by the rules of `namedIn`, over the items of its skip clause. Pass every station
 * of the alert's route as candidates, so a neighbour that matches better wins the item; the caller intersects the
 * result with the informed stops.
 */
export function headerNamedStations(header: string, candidates: readonly { id: StationId; name: string }[]): Set<StationId> {
  return namedIn(clauseItems(skipClause(header)), candidates)
}

/**
 * The two ends a header gives for "runs express from X to Y" or "express X to Y" (first line only), as the stations it
 * names among `candidates`; null when it has no such stretch or either end names no candidate.
 */
export function headerStretchEnds(header: string, candidates: readonly { id: StationId; name: string }[]): StationId[] | null {
  const line = header.split('\n')[0] ?? ''
  const m = /\bfrom\s+(.+?)\s+to\s+(.+?)(?=\n|;|\. |,| due to | for | while |$)/i.exec(line) ?? /\bexpress\s+(.+?)\s+to\s+(.+?)(?=\n|;|\. |,| due to | for | while |$)/i.exec(line)
  if (!m) return null
  const from = namedIn([canonTokens(m[1]!)], candidates)
  const to = namedIn([canonTokens(m[2]!)], candidates)
  return from.size > 0 && to.size > 0 ? [...from, ...to] : null
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
 * listed stops usually bracket the skipped ones; a header's "from X to Y" gives the ends, else the farthest pair). A stop `stationById` lacks is ignored; an empty set is omitted.
 */
export function skipSetsOf(alert: ServiceAlert, stationById: ReadonlyMap<StationId, Station>): RouteSkipSet[] {
  if (alertKindOf(alert.type) !== 'skip') return []
  const routes = [...new Set(alert.entities.filter((e) => e.stop !== null).map((e) => e.route))]
  const sets: RouteSkipSet[] = []
  for (const route of routes) {
    const entities = alert.entities.filter((e) => e.route === route && e.stop !== null && stationById.has(e.stop))
    const informed = [...new Set(entities.map((e) => e.stop!))]
    // Every station of the route, so a neighbour with a longer matching name takes the item; then the informed ones.
    const candidates = [...stationById.values()].filter((st) => st.routeIds.includes(route) || informed.includes(st.id)).map((st) => ({ id: st.id, name: st.name }))
    const named = new Set([...headerNamedStations(alert.header, candidates)].filter((id) => informed.includes(id)))
    let stations: ReadonlySet<StationId>
    let probable = false
    if (named.size > 0) {
      stations = named
    } else {
      probable = true
      // "runs express from X to Y" names the stretch's ends; else the farthest informed pair are the ends (none for two or fewer).
      const ends: StationId[] = headerStretchEnds(alert.header, candidates) ?? (informed.length <= 2 ? [] : stretchEnds(informed, (id) => stationById.get(id)!.pos))
      stations = new Set(informed.filter((id) => !ends.includes(id)))
    }
    if (stations.size === 0) continue
    sets.push({ alertId: alert.id, route, direction: sharedDirection(entities.map((e) => e.direction)), stations, probable, periods: alert.periods })
  }
  return sets
}
