import { describe, expect, it } from 'vitest'
import { clipLineBuffers } from './clipLineBuffers'
import { buildRouteClip, CLIP_END_PAD_M } from './routeClip'

/** A track along z = 0 from x = 0 to 100. */
const TRACK = [[{ x: 0, z: 0 }, { x: 100, z: 0 }]]

describe('clipLineBuffers', () => {
  it('cuts a segment where it leaves a track, interpolating position, height and color at the cut', () => {
    // The street runs on from the track to x = 200, 1 m off it, rising from y 2 to 4 and fading from 0 to 1 in red.
    const clip = buildRouteClip(TRACK)
    const out = clipLineBuffers({ positions: new Float32Array([0, 2, 1, 200, 4, 1]), colors: new Float32Array([0, 0.5, 1, 1, 0.5, 1]) }, clip)
    const cut = 100 + CLIP_END_PAD_M
    const t = cut / 200
    const want = { positions: [cut, 2 + 2 * t, 1, 200, 4, 1], colors: [t, 0.5, 1, 1, 0.5, 1] }
    expect(out.positions).toHaveLength(6)
    expect(out.colors).toHaveLength(6)
    out.positions.forEach((v, i) => expect(v).toBeCloseTo(want.positions[i]!, 4))
    out.colors.forEach((v, i) => expect(v).toBeCloseTo(want.colors[i]!, 6))
  })

  it('keeps a crossing segment as it was and drops one wholly under the track', () => {
    const crossing = [50, 0, -40, 50, 0, 40]
    const under = [10, 0, 1, 90, 0, 1]
    const out = clipLineBuffers(
      { positions: new Float32Array([...crossing, ...under]), colors: new Float32Array(12).fill(0.25) },
      buildRouteClip(TRACK),
    )
    expect([...out.positions]).toEqual(crossing)
    expect([...out.colors]).toEqual(Array(6).fill(0.25))
  })
})
