/**
 * How strongly the map shows the trip's route (TripLines.tsx) over the dimmed network. Pure, allocation-free: one
 * state eased per frame (SubwayLines, -0.25) and read by every line layer.
 */

/** Seconds for a full change (shown or not, faint or full). */
export const EMPHASIS_S = 0.25
/** A longer frame (a hidden tab's first frame back) counts as this long. */
const MAX_STEP_S = 0.1

/** Both 0..1, eased linearly toward their targets: `shown` the trip panel is in front with a route, `full` it is opened. */
export interface TripEmphasis {
  shown: number
  full: number
}

export interface EmphasisTarget {
  shown: boolean
  full: boolean
}

/** The theme's trip tokens (theme.ts). */
export interface EmphasisLook {
  lineWidth: number
  tripLineWidth: number
  tripNetworkDim: number
  tripFaintDim: number
}

/** What each layer draws this frame. */
export interface EmphasisLevels {
  /** The network's dim, 0..1 (the main layer and the ?lines= overlays). */
  networkDim: number
  /** The trip line's own dim: faint in the list view, 0 opened. */
  tripDim: number
  tripWidthPx: number
  /** The trip line draws at all (shown above 0). */
  tripVisible: boolean
  /** The trip's walks and station marks (TripDashes, TripMarks) fade in and out by opacity, 0..1, as the dim eases. */
  tripOpacity: number
}

export function createEmphasis(): TripEmphasis {
  return { shown: 0, full: 0 }
}

const toward = (v: number, target: number, step: number): number => (v < target ? Math.min(v + step, target) : Math.max(v - step, target))

/** Moves `e` toward `target` by one frame of `dtS` seconds, in place; reduced motion snaps. */
export function stepEmphasis(e: TripEmphasis, target: EmphasisTarget, dtS: number, reduced: boolean): void {
  const step = reduced ? 1 : Math.min(Math.max(dtS, 0), MAX_STEP_S) / EMPHASIS_S
  e.shown = toward(e.shown, target.shown ? 1 : 0, step)
  // While hidden it holds: a route that closes while opened eases out at its full look.
  if (target.shown) e.full = toward(e.full, target.full ? 1 : 0, step)
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

/**
 * The layers' looks for `e`, written into `out`. At shown 0 nothing is dimmed and the trip line draws exactly the main
 * line's pixels, so it comes in without a pop.
 */
export function emphasisLevels(e: TripEmphasis, look: EmphasisLook, out: EmphasisLevels): EmphasisLevels {
  const s = smooth(e.shown)
  const f = smooth(e.full)
  out.networkDim = s * look.tripNetworkDim
  out.tripDim = s * look.tripFaintDim * (1 - f)
  out.tripWidthPx = look.lineWidth + s * f * (look.tripLineWidth - look.lineWidth)
  out.tripVisible = e.shown > 0
  out.tripOpacity = s
  return out
}

export function createLevels(look: EmphasisLook): EmphasisLevels {
  return { networkDim: 0, tripDim: 0, tripWidthPx: look.lineWidth, tripVisible: false, tripOpacity: 0 }
}
