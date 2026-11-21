/**
 * Draw order of the transparent overlay layers (all use depthTest false). three.js draws every
 * opaque object before every transparent one, so these only sort within the transparent list.
 */
export const RENDER_ORDER = {
  grid: -1,
  lines: 1,
  lineFocus: 2,
  stationFill: 3,
  stationRing: 4,
  trains: 5,
} as const
