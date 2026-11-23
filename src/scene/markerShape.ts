/** Station marker shape for the instanced markers (Stations.tsx). */
export const MARKER_MIN_METERS = 6
export const MARKER_Y = 0.2
export const SEGMENTS = 24
/** Ring inner radius as a fraction of the marker radius. */
export const RING_INNER = 0.78
/** A trip mark (TripMarks.tsx), as fractions of its radius: the ring's inner edge, the background halo, a start or end's dot. */
export const TRIP_MARK_INNER = 0.62
export const TRIP_MARK_HALO = 1.2
export const TRIP_MARK_DOT = 0.4
export const TRIP_MARK_MIN_METERS = 9
/** A skipped station's cross (TripMarks.tsx), as fractions of its mark's radius: each arm's half-length (to the ring's inner edge) and full width. */
export const SKIP_CROSS_HALF = TRIP_MARK_INNER
export const SKIP_CROSS_WIDTH = 0.2
