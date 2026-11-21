/**
 * TEMPORARY until the car look is picked (underground-pah.5 look round). `?cars=a|b|c` picks the car
 * body: a (default) a box, b a chamfered prism, c a flat slab. Once decided, remove together:
 * - this file: replace `carLook` with constants for the chosen body
 * - carGeometry.ts: the unchosen `section` branches (and `roofInsetM` unless b wins)
 * - AGENTS.md: the `?cars=` TEMPORARY note
 */
export interface CarLook {
  /** box: rectangular section; prism: hexagonal section with a chamfered roof; slab: a thin box. */
  section: 'box' | 'prism' | 'slab'
  widthM: number
  heightM: number
  /** prism: how far each roof edge is set in from the side walls. */
  roofInsetM: number
}

const LOOKS = {
  a: { section: 'box', widthM: 3, heightM: 3.2, roofInsetM: 0 },
  b: { section: 'prism', widthM: 3, heightM: 3.6, roofInsetM: 0.6 },
  c: { section: 'slab', widthM: 3, heightM: 0.4, roofInsetM: 0 },
} as const satisfies Record<string, CarLook>

export function resolveCarLook(search: string): CarLook {
  const name = new URLSearchParams(search).get('cars')
  return name === 'b' || name === 'c' ? LOOKS[name] : LOOKS.a
}

export const carLook: CarLook = resolveCarLook(window.location.search)
