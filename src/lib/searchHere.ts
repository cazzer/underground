/** What the search dialog says about the user's own location: the "My location" row, the status, the sort distance (pure). */
import type { StationId } from '../data/schema'
import type { LocateState, MarkedPlacement } from './locate'
import { formatDistance, locateMessage, type LocateMessage } from './locateMessage'
import type { Station } from './network'
import type { TripPlace } from './trip'
import type { Ground } from './projection'
import type { StationGroup } from './stationGroups'
import { SEARCH_LIMIT } from './stationSearch'

/** The note a trip end set from "My location" keeps, as a place's name is: "near you", spoken "nearest station to you". */
export const HERE_NOTE = 'you'

/** The trip place of an end set from "My location": the note, no point (the fix is never drawn to or sent anywhere). */
export const HERE_PLACE: TripPlace = { note: HERE_NOTE, ground: null }

export interface HereRow {
  /** The station it stands for: the group's id (a complex's lead). */
  nearestId: StationId
  title: string
  /** The dim line: "Nearest station Bedford Av · about 0.2 mi" (the header's miles: one distance system for one fix). */
  detail: string
  /** The row's accessible name. */
  spoken: string
}

/** The "My location" row for a marked fix; null with none (an outside fix gets no row). */
export function hereRow(fix: MarkedPlacement | null): HereRow | null {
  if (!fix) return null
  const { name } = fix.nearest
  const distance = formatDistance(fix.nearest.distanceM)
  return {
    nearestId: fix.nearest.id,
    title: 'My location',
    detail: `Nearest station ${name} · ${distance}${fix.approximate ? ' · approximate' : ''}`,
    spoken: `My location, nearest station ${name}, ${distance}${fix.approximate ? ', approximate' : ''}`,
  }
}

export interface HereStatus {
  /** For the dialog's polite region; empty when idle. */
  spoken: string
  /** The line shown (aria-hidden: the region speaks it); null on success, where the row is the result. */
  visible: Pick<LocateMessage, 'text' | 'tone'> | null
}

/** What pressing "Use my location" has found so far, in the words the header uses (`locateMessage`). */
export function hereStatus(state: LocateState): HereStatus {
  const message = locateMessage(state)
  if (!message) return { spoken: '', visible: null }
  if (state.status === 'located' && state.placement.kind !== 'outside') {
    // The focus moves to the row, which speaks the rest.
    return { spoken: 'Found your location.', visible: null }
  }
  return { spoken: message.text, visible: { text: message.text, tone: message.tone } }
}

/** The result count for the dialog's polite region while text is typed. */
export function searchStatusText(typed: boolean, count: number): string {
  if (!typed) return ''
  if (count === 0) return 'No stations match'
  if (count >= SEARCH_LIMIT) return `Top ${SEARCH_LIMIT} stations`
  return `${count} station${count === 1 ? '' : 's'}`
}

/** A group's distance to a point: its nearest member's (a complex is as near as its nearest member). */
export function fixDistanceOf(ground: Ground, stationById: ReadonlyMap<StationId, Station>): (group: StationGroup) => number {
  return (group) => {
    let best = Infinity
    for (const id of group.memberIds) {
      const member = stationById.get(id)
      if (!member) throw new Error(`Station group ${group.id} lists member ${id}, which the network lacks`)
      best = Math.min(best, Math.hypot(member.pos.x - ground.x, member.pos.z - ground.z))
    }
    return best
  }
}
