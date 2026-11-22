/** Whether a station already stands for one of the trip's ends. Pure. */
import type { TripEnds } from './tripView'

/**
 * Whether `stationId` is the trip's From or To, or another member of the same station complex as one of them
 * (`siblings`, its complex's other members: `siblingIdsOf`), which a trip treats as the same place (`complexMembers`).
 */
export function isTripEnd(stationId: string, siblings: readonly string[], ends: TripEnds): boolean {
  const is = (id: string | null) => id !== null && (id === stationId || siblings.includes(id))
  return is(ends.from) || is(ends.to)
}
