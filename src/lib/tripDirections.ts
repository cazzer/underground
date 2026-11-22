/** Which ends a directions pick gives the trip. Pure; no React, fetch or storage. */
import type { MarkedPlacement } from './locate'
import type { TripEnd, TripPlaces } from './trip'
import type { TripEnds } from './tripView'

/** What a directions pick names: a station, or a searched place's nearest station plus the place's name. */
export interface DirectionsTarget {
  stationId: string
  place: string | null
}

export interface DirectionsInput {
  /** The end the pick sets. */
  end: TripEnd
  target: DirectionsTarget
  current: TripEnds
  currentPlaces: TripPlaces
  focusedId: string | null
  /** Any station's complex siblings (its group's other members): no candidate may be the target or one of them. */
  siblingsOf: (stationId: string) => readonly string[]
  /** The marked location fix (markedPlacement), read here and kept nowhere. */
  fix: MarkedPlacement | null
}

export interface DirectionsTrip {
  ends: TripEnds
  places: TripPlaces
  /** The end left unset: focus goes to its row. Null when both ends are set. */
  empty: TripEnd | null
}

interface Candidate {
  id: string | null
  note: string | null
}

/** The two ends from the picked one and the other one, whichever is From. */
function pair<T>(end: TripEnd, picked: T, other: T): { from: T; to: T } {
  return end === 'from' ? { from: picked, to: other } : { from: other, to: picked }
}

/**
 * The trip a directions pick opens. The picked end is the target (a place keeps its note). The other end is the
 * first of: the trip's earlier other end (an end already chosen stays), the marked fix's nearest station (From
 * only: a fix is where you start), the focused station, the trip's earlier picked end (so "Directions from B" on A
 * to B gives the way back, B to A). Each must be neither the target nor in its complex. An earlier end keeps its
 * note; nothing else carries one. The two ends are never the same station, nor two of one complex.
 */
export function directionsTrip({ end, target, current, currentPlaces, focusedId, siblingsOf, fix }: DirectionsInput): DirectionsTrip {
  const x = target.stationId
  const other: TripEnd = end === 'from' ? 'to' : 'from'
  const siblings = siblingsOf(x)
  const candidates: Candidate[] = [
    { id: current[other], note: currentPlaces[other] },
    { id: other === 'from' ? (fix?.nearest.id ?? null) : null, note: null },
    { id: focusedId, note: null },
    { id: current[end], note: currentPlaces[end] },
  ]
  const winner = candidates.find((c) => c.id !== null && c.id !== x && !siblings.includes(c.id))
  return {
    ends: pair(end, x, winner?.id ?? null),
    places: pair(end, target.place, winner?.note ?? null),
    empty: winner ? null : other,
  }
}
