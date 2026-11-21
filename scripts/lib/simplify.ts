import type { Ground } from '../../src/lib/projection.ts'

function distanceToSegment(p: Ground, a: Ground, b: Ground): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.z - a.z)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

/** Douglas-Peucker over ground points (meters). Returns ascending kept indices; ends are always kept. */
export function simplifyIndices(points: readonly Ground[], toleranceM: number): number[] {
  const n = points.length
  if (n < 3) return points.map((_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let farthest = -1
    let farthestDistance = toleranceM
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i]!, points[first]!, points[last]!)
      if (d > farthestDistance) {
        farthest = i
        farthestDistance = d
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  const kept: number[] = []
  keep.forEach((flag, i) => {
    if (flag) kept.push(i)
  })
  return kept
}
