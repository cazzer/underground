import { useViewStations, type ViewStationsOptions } from './useViewStations'

/** Runs `useViewStations` inside the Canvas (it needs the camera and the controls); draws nothing. */
export function ViewStationsSource(props: ViewStationsOptions): null {
  useViewStations(props)
  return null
}
