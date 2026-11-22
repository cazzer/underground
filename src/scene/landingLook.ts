/**
 * TEMPORARY switch for the 2q7.25 landing-turn card. By default a landing on an interior with a priority frame (the
 * trip's path, the machines out of service) keeps the usual landing turn (priorityLanding). `?landturn=half` lets that
 * turn go half way round when the far side shows more of the frame (priorityTurn in lib/pathFrame.ts): at Pelham Pkwy
 * (211) on a phone the station-house machines then land in the free area, south up. Once the card is decided, remove
 * together:
 * - this file
 * - cameraFlight.ts: `interiorFlight`'s `halfTurn` parameter (keep or drop the `priorityTurn` branch);
 *   useStationFlights.ts and useInteriorReframe.ts: the `landingLook` import and argument
 * - pathFrame.ts: `priorityTurn` if the half turn is dropped; pathFrame.data.test.ts and outageFrame.data.test.ts:
 *   the "?landturn=half" cases (or their default cases, if it is kept)
 * - AGENTS.md: the `?landturn=` TEMPORARY note in the theme bullets and "(`?landturn=half`)" by `priorityTurn` in the
 *   station interior conventions
 */
export type LandingLook = 'usual' | 'half'

export function resolveLandingLook(search: string): LandingLook {
  return new URLSearchParams(search).get('landturn') === 'half' ? 'half' : 'usual'
}

export const landingLook: LandingLook = resolveLandingLook(window.location.search)
