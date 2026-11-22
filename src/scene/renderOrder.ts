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
  // The citywide basemap (Basemap.tsx), one layer per class: over the station streets, whose radius it masks its
  // roads out of as they fade in, and under the location disc and the route lines. Roads over water and parks.
  basemapPark: 0.36,
  basemapWater: 0.37,
  basemapPath: 0.38,
  basemapMinor: 0.39,
  basemapMajor: 0.4,
  basemapHighway: 0.41,
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
  // The streets above the interior veil, under the interior strokes, while the interior is loaded under look A (at the
  // fainter veiled stroke, streetVeil.ts); forced either way by the TEMPORARY ?streets= (streetsLook.ts).
  streetsOver: 7.5,
  // The street file's entrance marks the interior doesn't draw itself: above the veil like the interior's own
  // entrance squares, under its strokes.
  streetEntrance: 7.6,
  interiorFine: 8,
  interior: 9,
  // Trains on a revealed station's platforms (its deepest deck's, spanCarOrders), redrawn above the veil and those
  // strokes: footprints, bodies (depth-tested against the street cars they copy), then the selected outline's rim and
  // gap shells, as on the street.
  spanCarHalo: 9.45,
  spanCars: 9.5,
  spanCarRim: 9.51,
  spanCarGap: 9.52,
  // The interior's levels above its shallowest deck (mezzanines, their stairs, escalators and shafts, the street), fine
  // then strong, over the lifted trains: they stand in front of them.
  interiorOverFine: 9.6,
  interiorOver: 9.7,
  // The focus ring of a focused station with no interior, redrawn over the trains.
  focusRing: 10,
} as const

/** A stroke band's layers (interiorDecks.ts): fine, strong, and the exit path drawn over them (2q7.12). */
export interface StrokeOrders {
  fine: number
  strong: number
  exitPath: number
}

/** A deck's lifted trains, in SpanCars' passes: footprints, bodies, the selected outline's rim and gap shells. */
export interface SpanCarOrders {
  halo: number
  body: number
  rim: number
  gap: number
}

/** Band 0 and the top band (the levels above the shallowest deck). Their exit paths are 2q7.12's exitPath and exitPathOver. */
const BASE_BAND: StrokeOrders = { fine: RENDER_ORDER.interiorFine, strong: RENDER_ORDER.interior, exitPath: 9.3 }
const TOP_BAND: StrokeOrders = { fine: RENDER_ORDER.interiorOverFine, strong: RENDER_ORDER.interiorOver, exitPath: 9.8 }
/** Bands between decks at a multi-deck interior (Union Sq): band 1, then band 2. */
const MID_BANDS: readonly StrokeOrders[] = [
  { fine: 9.53, strong: 9.54, exitPath: 9.545 },
  { fine: 9.57, strong: 9.575, exitPath: 9.578 },
]
/** Deck 0 (the deepest, and a single-deck station's only one), then decks 1 and 2, each right after its band. */
const DECK_TRAINS: readonly SpanCarOrders[] = [
  { halo: RENDER_ORDER.spanCarHalo, body: RENDER_ORDER.spanCars, rim: RENDER_ORDER.spanCarRim, gap: RENDER_ORDER.spanCarGap },
  { halo: 9.55, body: 9.555, rim: 9.56, gap: 9.565 },
  { halo: 9.58, body: 9.585, rim: 9.59, gap: 9.595 },
]

/**
 * Render orders of stroke band `band` of `bandCount` (decks + 1): band 0 at 8/9, the top band at 9.6/9.7, and the
 * bands between decks in between, each just after the lifted trains of the deck below it. One band (no decks) is
 * band 0 alone. Throws past MAX_DECKS (interiorDecks never gives more).
 */
export function strokeOrders(band: number, bandCount: number): StrokeOrders {
  if (band === 0) return BASE_BAND
  if (band === bandCount - 1) return TOP_BAND
  const mid = MID_BANDS[band - 1]
  if (!mid || band > bandCount - 1) throw new Error(`No render order for stroke band ${band} of ${bandCount}`)
  return mid
}

/** Render orders of deck `deck`'s lifted trains (0 is the deepest). Throws past MAX_DECKS. */
export function spanCarOrders(deck: number): SpanCarOrders {
  const orders = DECK_TRAINS[deck]
  if (!orders) throw new Error(`No render order for platform deck ${deck}`)
  return orders
}
