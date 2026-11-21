/**
 * The plan direction a station runs in. Type-only imports with .ts paths: scripts/lib/interiorRegistry.test.ts
 * (nodenext) loads this file.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema.ts'

const perimeter = (outline: readonly LocalPoint[]) =>
  outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length]!
    return sum + Math.hypot(b[0] - a[0], b[1] - a[1])
  }, 0)

/**
 * Principal direction of the longest platform outline, as a unit vector pointing east (or south when
 * due north-south); +x without platforms. Each edge adds its direction weighted by its length, so an
 * OSM outline with its long sides split into many short edges still reads along its length.
 */
export function stationAxis(interior: StationInterior): LocalPoint {
  const longest = interior.platforms.reduce<readonly LocalPoint[] | null>(
    (best, p) => (!best || perimeter(p.outline) > perimeter(best) ? p.outline : best),
    null,
  )
  if (!longest) return [1, 0]
  // Length-weighted second moment of the edge directions: [[xx, xz], [xz, zz]].
  let xx = 0
  let xz = 0
  let zz = 0
  for (let i = 0; i < longest.length; i++) {
    const a = longest[i]!
    const b = longest[(i + 1) % longest.length]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    xx += (dx * dx) / len
    xz += (dx * dz) / len
    zz += (dz * dz) / len
  }
  const angle = Math.atan2(2 * xz, xx - zz) / 2
  const axis: LocalPoint = [Math.cos(angle), Math.sin(angle)]
  return axis[0] < -1e-9 || (Math.abs(axis[0]) <= 1e-9 && axis[1] < 0) ? [-axis[0], -axis[1]] : axis
}
