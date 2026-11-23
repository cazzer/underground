import type { LocationCap } from '../lib/basemap/locationCapHandle'
import { useLocationCap } from './useLocationCap'

interface LocationCapSourceProps {
  cap: LocationCap
}

/** Runs `useLocationCap` inside the Canvas (it needs the controls' element); draws nothing. */
export function LocationCapSource({ cap }: LocationCapSourceProps): null {
  useLocationCap(cap)
  return null
}
