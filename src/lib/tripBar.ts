import type { TripEnds } from './tripView'

export interface TripBarText {
  /** The collapsed bar's visible line. */
  text: string
  /** What a screen reader reads in its place. */
  spoken: string
}

/** The collapsed trip panel's one line: "A → B", "From A", "To B" or "Trip". */
export function tripBarText(ends: TripEnds, stationName: (id: string) => string): TripBarText {
  const from = ends.from === null ? null : stationName(ends.from)
  const to = ends.to === null ? null : stationName(ends.to)
  if (from !== null && to !== null) return { text: `${from} → ${to}`, spoken: `Trip from ${from} to ${to}` }
  if (from !== null) return { text: `From ${from}`, spoken: `Trip from ${from}` }
  if (to !== null) return { text: `To ${to}`, spoken: `Trip to ${to}` }
  return { text: 'Trip', spoken: 'Trip' }
}
