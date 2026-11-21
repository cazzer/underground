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
 * Dots from this camera distance out, cars from CARS_AT in. DOTS_FROM_M matches where the camera starts
 * to tilt (DEFAULT_TILT.farDistance in tilt.ts), so the view is top-down while a train first unfolds and
 * its body height doesn't show; writeConsist also ramps the height in, in case the two ever move apart.
 */
export const DOTS_FROM_M = 1400
export const CARS_AT_M = 900

/** 0 draws dots, 1 draws cars; a smoothstep in log distance between, so zooming at a steady rate feels even. */
export function carMix(distance: number): number {
  const x = Math.log(DOTS_FROM_M / distance) / Math.log(DOTS_FROM_M / CARS_AT_M)
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}
