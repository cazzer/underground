/** The longest consist drawn (the 7 runs 11 cars); car instances are allocated per slot at this count. */
export const MAX_CARS = 11

/** A train's car count and car pitch (coupler to coupler, meters). */
export interface Consist {
  cars: number
  pitchM: number
}

/** Car lengths: A division 51 ft, B division 60 ft and 75 ft. */
const A_CAR_M = 15.5
const B60_CAR_M = 18.3
const B75_CAR_M = 22.9

const A_TEN: Consist = { cars: 10, pitchM: A_CAR_M }
const A_ELEVEN: Consist = { cars: 11, pitchM: A_CAR_M }
// Approximate: the shuttles, the G and Staten Island run varying short consists.
const A_SHUTTLE: Consist = { cars: 6, pitchM: A_CAR_M }
const B60_EIGHT: Consist = { cars: 8, pitchM: B60_CAR_M }
const B60_FIVE: Consist = { cars: 5, pitchM: B60_CAR_M }
const B75_TWO: Consist = { cars: 2, pitchM: B75_CAR_M }
const B75_FOUR: Consist = { cars: 4, pitchM: B75_CAR_M }
/** Every other B division route, and any unknown route. */
export const DEFAULT_CONSIST: Consist = { cars: 10, pitchM: B60_CAR_M }

const BY_ROUTE: ReadonlyMap<string, Consist> = new Map([
  ['1', A_TEN],
  ['2', A_TEN],
  ['3', A_TEN],
  ['4', A_TEN],
  ['5', A_TEN],
  ['6', A_TEN],
  ['6X', A_TEN],
  ['7', A_ELEVEN],
  ['7X', A_ELEVEN],
  ['GS', A_SHUTTLE],
  ['L', B60_EIGHT],
  ['J', B60_EIGHT],
  ['Z', B60_EIGHT],
  ['M', B60_EIGHT],
  ['G', B60_FIVE],
  ['FS', B75_TWO],
  ['H', B75_FOUR],
  ['SI', B75_FOUR],
])

/** The consist drawn for a route. Returns a shared object: do not mutate it. */
export function consistFor(routeId: string | null): Consist {
  return (routeId !== null && BY_ROUTE.get(routeId)) || DEFAULT_CONSIST
}

/**
 * Distance along a shape of the train's center: the dot's distance, moved in so a `trainM`-long train
 * stays on the shape. A shape shorter than the train centers it on the shape.
 */
export function consistCenter(lengthM: number, shown: number, trainM: number): number {
  if (lengthM <= trainM) return lengthM / 2
  return Math.min(Math.max(shown, trainM / 2), lengthM - trainM / 2)
}

/**
 * Dots from this camera distance out, cars from CARS_AT in. DOTS_FROM_M sits well outside where the camera
 * starts to tilt (DEFAULT_TILT.farDistance, 1400 m), so a train unfolds into a flat, true-length footprint
 * while the view is top-down; its height then grows with the depth factor as the camera tips (writeConsist).
 */
export const DOTS_FROM_M = 2400
export const CARS_AT_M = 1600

/** The selected train stays cars much farther out: cars to 12 km, a dot only past 20 km. */
export const SELECTED_DOTS_FROM_M = 20_000
export const SELECTED_CARS_AT_M = 12_000

/** 0 at `dotsFrom` and beyond, 1 at `carsAt` and closer; a smoothstep in log distance between. */
function mixBetween(distance: number, dotsFrom: number, carsAt: number): number {
  const x = Math.log(dotsFrom / distance) / Math.log(dotsFrom / carsAt)
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

/** 0 draws dots, 1 draws cars; a smoothstep in log distance between, so zooming at a steady rate feels even. */
export function carMix(distance: number): number {
  return mixBetween(distance, DOTS_FROM_M, CARS_AT_M)
}

/** carMix for the selected train (selectedMix.ts eases a slot onto and off it). Never below carMix. */
export function selectedCarMix(distance: number): number {
  return mixBetween(distance, SELECTED_DOTS_FROM_M, SELECTED_CARS_AT_M)
}

/**
 * How far from the view center (meters, on the ground) cars are laid out: three camera distances at full
 * tilt, one at top-down (the view reaches the horizon only when tipped), plus 300 m of slack. `tilt` is
 * tiltT(d); the rest of the trains stay dots or zeroed.
 */
export function carsReach(distance: number, tilt: number): number {
  return (1 + 2 * tilt) * distance + 300
}
