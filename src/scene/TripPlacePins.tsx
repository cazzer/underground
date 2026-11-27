import type { TripRouteDraw } from '../lib/tripLineBuffers'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { PlacePin } from './PlacePin'

interface TripPlacePinsProps {
  /** The route SubwayLines holds (it keeps the last one while it eases out); null with none. */
  route: TripRouteDraw | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
  /** The focused interior is loaded under the screen veil: the pins draw above it while it reveals. */
  overVeil: boolean
}

/**
 * A pin on each searched place a trip's end was picked from (the route's `places`), for the route SubwayLines holds, so
 * the pins ease out with its walks: shown, faint-dimmed and above the veil exactly as TripDashes draws them. None for a
 * service change's route (its `places` is empty).
 */
export function TripPlacePins({ route, levels, overVeil }: TripPlacePinsProps) {
  if (!route || route.kind !== 'trip') return null
  return (
    <>
      {route.places.map((ground, i) => (
        <PlacePin key={`${i}:${ground.x},${ground.z}`} ground={ground} trip={{ levels, overVeil }} />
      ))}
    </>
  )
}
