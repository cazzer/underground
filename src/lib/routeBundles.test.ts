import { describe, expect, it } from 'vitest'
import { BUNDLE_STRIDE, routeBundles } from './routeBundles'
import type { StreetLabelSource } from './streetRuns'

const anchor = { x: 1000, z: 2000 }

/** One street running east along z = 0 (meters from the anchor), three candidates. */
const streets: StreetLabelSource[] = [
  {
    key: 'w 41 st',
    text: 'W 41 St',
    lengthM: 200,
    runs: [
      [
        { x: 0, z: 0, tx: 1, tz: 0 },
        { x: 60, z: 0, tx: 1, tz: 0 },
        { x: -60, z: 0, tx: 1, tz: 0 },
      ],
    ],
  },
]

/** Each candidate's [routes, lo, hi]. */
const rows = (a: Float32Array) => Array.from({ length: a.length / BUNDLE_STRIDE }, (_, k) => [...a.subarray(k * 3, k * 3 + 3)])
const counts = (a: Float32Array) => rows(a).map((r) => r[0])

const track = (routeId: string, pts: [number, number][]) => ({ routeId, points: pts.map(([x, z]) => ({ x: anchor.x + x, z: anchor.z + z })) })

describe('routeBundles', () => {
  it('counts the distinct routes along the street at each candidate, and how far either side their tracks lie', () => {
    const tracks = [
      // Two directions of route 1 and one of route 2 along the street's east half, 5 m either side and 8 m south.
      track('1', [[20, 5], [200, 5]]),
      track('1', [[200, -5], [20, -5]]),
      track('2', [[20, 8], [200, 8]]),
    ]
    const [[run]] = routeBundles(streets, anchor, tracks, 250) as [[Float32Array]]
    // The street runs east (+x); its left, (-tz, tx) = (0, 1), is south (+z).
    expect(rows(run)).toEqual([
      [0, 0, 0],
      [2, -5, 8],
      [0, 0, 0],
    ])
  })

  it('ignores a line that only crosses the street, or runs farther than 12 m off it', () => {
    const tracks = [track('7', [[60, -100], [60, 100]]), track('3', [[-200, 20], [200, 20]])]
    expect(counts(routeBundles(streets, anchor, tracks, 250)[0]![0]!)).toEqual([0, 0, 0])
  })

  it('looks only at tracks within reach of the anchor', () => {
    const tracks = [track('1', [[-60, 2], [60, 2]])]
    expect(counts(routeBundles(streets, anchor, tracks, 250)[0]![0]!)).toEqual([1, 1, 1])
    const far = [track('1', [[1000, 2], [1200, 2]])]
    expect(counts(routeBundles(streets, anchor, far, 250)[0]![0]!)).toEqual([0, 0, 0])
  })
})
