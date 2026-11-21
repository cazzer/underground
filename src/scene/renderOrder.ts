/**
 * Draw order of the transparent overlay layers. All use depthTest false except the train car bodies,
 * which test and write depth so a far car can't paint over a near one at iso tilt (nothing earlier
 * writes depth: the grid has depthWrite off, since cars can run below the street). three.js draws every opaque object before every transparent one,
 * so these only sort within the transparent list.
 */
export const RENDER_ORDER = {
  grid: -1,
  lines: 1,
  // From a station marker down to its sunken platform tracks, under the marker disc.
  stationTie: 1.5,
  lineFocus: 2,
  stationFill: 3,
  stationRing: 4,
  trainHalo: 5,
  trains: 6,
  // The selected train's dot, drawn on its own above the other dots: its rim, a background gap, the dot.
  selectedTrainRim: 6.1,
  selectedTrainHalo: 6.15,
  selectedTrain: 6.2,
  // Zoomed in, each train is a consist of cars: background-colored footprints, then the bodies.
  carRim: 5.25,
  carHalo: 5.5,
  cars: 6.5,
  // "You are here": the accuracy disc and its edge sit under the lines; the reticle sits over the trains, under the veil.
  hereAccuracy: 0.5,
  hereAccuracyEdge: 0.6,
  hereHalo: 6.4,
  here: 6.55,
  // Station interior. Look C (?interior=c, temporary) draws it under the street layers.
  interiorUnderFine: -0.6,
  interiorUnder: -0.3,
  // The veil dims everything above (live trains included), then fine and strong interior strokes of the platform level
  // the lifted trains ride and the levels below it.
  interiorVeil: 7,
  interiorFine: 8,
  interior: 9,
  // Trains on a revealed station's platforms, redrawn above the veil and those strokes: rim, footprints, bodies
  // (depth-tested against the street cars they copy).
  spanCarRim: 9.4,
  spanCarHalo: 9.45,
  spanCars: 9.5,
  // The interior's levels above that platform (mezzanines, their stairs, escalators and shafts, the street), fine
  // then strong, over the lifted trains: they stand in front of them.
  interiorOverFine: 9.6,
  interiorOver: 9.7,
  // The focus ring of a focused station with no interior, redrawn over the trains.
  focusRing: 10,
} as const
