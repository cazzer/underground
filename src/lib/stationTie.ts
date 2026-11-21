/**
 * A station with no depth (no authored platform track) still gets a tether when it is focused without an
 * interior: a short stub, STUB_DEPTH_M drawn meters long at full tilt. It lives in the tie layer, so it scales
 * with the depth factor like the real ties and is a flat tick top-down.
 */
export const STUB_DEPTH_M = 12

/** What the tie layer does with the focused station's own tie. */
export type FocusedTie = 'drop' | 'keep' | 'stub'

/**
 * `hasTie`: the station has a depth tie in the layer. `markerShown`: its street marker is drawn (the no-interior
 * fallback). A station marked by its interior drops its tie; a fallback keeps its tie, or gets the stub when it has none.
 */
export function focusedTie(hasTie: boolean, markerShown: boolean): FocusedTie {
  if (!markerShown) return 'drop'
  return hasTie ? 'keep' : 'stub'
}
