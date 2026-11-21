import type { Ground } from './projection'

/**
 * Of the instances whose hit discs the pointer landed in, the one whose station is nearest the
 * ground point under the pointer; -1 if there are none. Overlapping discs at the overview make
 * the raycaster's first hit arbitrary, so the nearest center decides.
 */
export function nearestHit(instanceIds: readonly number[], positions: readonly Ground[], point: Ground): number {
  let best = -1
  let bestDistance = Infinity
  for (const id of instanceIds) {
    const p = positions[id]
    if (!p) continue
    const d = Math.hypot(p.x - point.x, p.z - point.z)
    if (d < bestDistance) {
      bestDistance = d
      best = id
    }
  }
  return best
}
