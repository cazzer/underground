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
  trainHalo: 5,
  trains: 6,
  // Station interior. Look C (?interior=c, temporary) draws it under the street layers.
  interiorUnderFine: -0.6,
  interiorUnder: -0.3,
  // The veil dims everything above (live trains included), then fine and strong interior strokes.
  interiorVeil: 7,
  interiorFine: 8,
  interior: 9,
  // The focused station's ring, redrawn over the veil while an interior shows.
  interiorFocusRing: 10,
} as const
