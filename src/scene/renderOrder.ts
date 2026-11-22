/**
 * Draw order of the transparent overlay layers. All use depthTest false except the train car bodies,
 * which test and write depth so a far car can't paint over a near one at iso tilt (nothing earlier
 * writes depth: the grid has depthWrite off, since cars can run below the street). three.js draws every opaque object before every transparent one,
 * so these only sort within the transparent list.
 */
export const RENDER_ORDER = {
  grid: -1,
  // The focused station's streets, at street level under the location disc and the route lines.
  streets: 0.35,
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
  carHalo: 5.5,
  cars: 6.5,
  // The selected train's outline: back faces of two shells around its cars, the rim then a background gap inside
  // it, depth-tested against the bodies so only the band outside each silhouette shows (and a nearer car hides it).
  carRim: 6.51,
  carGap: 6.52,
  // While the other trains are still dots (carMix below 1), the same shells draw above those dots, under its own
  // shrinking dot (6.1 to 6.2), before any body, so the bodies paint over their inside.
  selectedCarRim: 6.03,
  selectedCarGap: 6.06,
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
  // The streets above the interior veil, under the interior strokes, while the interior is loaded under look A (dimmed
  // with the veil, streetVeil.ts); forced either way by the TEMPORARY ?streets= (streetsLook.ts).
  streetsOver: 7.5,
  // The street file's entrance marks the interior doesn't draw itself: above the veil like the interior's own
  // entrance squares, under its strokes.
  streetEntrance: 7.6,
  interiorFine: 8,
  interior: 9,
  // Trains on a revealed station's platforms, redrawn above the veil and those strokes: footprints, bodies
  // (depth-tested against the street cars they copy), then the selected outline's rim and gap shells, as on the street.
  spanCarHalo: 9.45,
  spanCars: 9.5,
  spanCarRim: 9.51,
  spanCarGap: 9.52,
  // The interior's levels above that platform (mezzanines, their stairs, escalators and shafts, the street), fine
  // then strong, over the lifted trains: they stand in front of them.
  interiorOverFine: 9.6,
  interiorOver: 9.7,
  // The focus ring of a focused station with no interior, redrawn over the trains.
  focusRing: 10,
} as const
