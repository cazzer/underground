/**
 * TEMPORARY until the station orbit limit is picked (underground-pah.5 look round).
 * `?orbit=a|b|c` picks the azimuth window half-width: 30, 45 (default), 60 degrees. Once decided,
 * remove together:
 * - this file: fold the chosen angle into a constant in `src/lib/orbitLimits.ts`
 * - useStationOrbit.ts: the `orbitLook` import
 * - AGENTS.md: the `?orbit=` TEMPORARY note
 */
export interface OrbitLook {
  /** Half-width of the azimuth window at full tilt, radians. */
  limit: number
}

const DEGREES = { a: 30, b: 45, c: 60 } as const

export function resolveOrbitLook(search: string): OrbitLook {
  const name = new URLSearchParams(search).get('orbit')
  const deg = name === 'a' || name === 'c' ? DEGREES[name] : DEGREES.b
  return { limit: (deg * Math.PI) / 180 }
}

export const orbitLook: OrbitLook = resolveOrbitLook(window.location.search)
