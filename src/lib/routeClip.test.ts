import { describe, expect, it } from 'vitest'
import type { Ground } from './projection'
import { buildRouteClip, CLIP_END_PAD_M, CLIP_MIN_PIECE_M, keptPieces, type RouteClip } from './routeClip'

const line = (...xz: [number, number][]): Ground[] => xz.map(([x, z]) => ({ x, z }))
/** The two direction tracks of a straight east-west line, 4.7 m either side of z = 0, from x = 0 to 300. */
const PAIR = [line([0, -4.7], [300, -4.7]), line([300, 4.7], [0, 4.7])]

/** Kept stretches of the street a→b in meters along it. */
function kept(clip: RouteClip, a: [number, number], b: [number, number]): [number, number][] {
  const out: number[] = []
  const n = keptPieces(clip, a[0], a[1], b[0], b[1], out)
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return Array.from({ length: n }, (_, i) => [out[2 * i]! * len, out[2 * i + 1]! * len])
}

/** Kept stretches of a polyline street, in meters along the whole of it, joined where pieces meet. */
function keptAlong(clip: RouteClip, pts: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
    for (const [a, b] of kept(clip, pts[i - 1]!, pts[i]!)) {
      const last = out[out.length - 1]
      if (last && Math.abs(last[1] - (d + a)) < 1e-6) last[1] = d + b
      else out.push([d + a, d + b])
    }
    d += len
  }
  return out
}

describe('keptPieces', () => {
  it('drops a street running between the two tracks of a line, over its whole length', () => {
    const clip = buildRouteClip(PAIR)
    expect(kept(clip, [0, 0], [300, 0])).toEqual([])
    expect(kept(clip, [300, 0], [0, 0])).toEqual([])
  })

  it('keeps a street crossing the line at 90 and at 20 degrees', () => {
    const clip = buildRouteClip(PAIR)
    expect(kept(clip, [150, -100], [150, 100])).toEqual([[0, 200]])
    const c = Math.cos((20 * Math.PI) / 180) * 100
    const s = Math.sin((20 * Math.PI) / 180) * 100
    expect(kept(clip, [150 - c, -s], [150 + c, s])).toEqual([[0, 200]])
  })

  it('keeps a parallel street 20 m off the line', () => {
    const clip = buildRouteClip(PAIR)
    expect(kept(clip, [0, 20], [300, 20])).toEqual([[0, 300]])
  })

  it('keeps a street from just past where the line ends', () => {
    const clip = buildRouteClip(PAIR)
    const got = kept(clip, [200, 0], [500, 0])
    expect(got).toHaveLength(1)
    expect(got[0]![0]).toBeCloseTo(100 + CLIP_END_PAD_M, 6)
    expect(got[0]![1]).toBeCloseTo(300, 6)
  })

  it('leaves no piece of a street following a 30 degree bend in the line', () => {
    const c = Math.cos(Math.PI / 6) * 200
    const s = Math.sin(Math.PI / 6) * 200
    const clip = buildRouteClip([line([0, 0], [200, 0], [200 + c, s])])
    // The street 4.7 m to the left (north) of the line, as a direction track sits beside the other.
    const off = 4.7
    const bend: [number, number] = [200 + off * Math.tan(Math.PI / 12), -off]
    const street: [number, number][] = [[0, -off], bend, [bend[0] + c, bend[1] + s]]
    expect(keptAlong(clip, street)).toEqual([])
  })

  it('cuts one long segment and the same street in 7 m pieces alike, within the shortest piece', () => {
    const clip = buildRouteClip(PAIR)
    const whole = kept(clip, [-150, 0], [450, 0])
    const pts: [number, number][] = Array.from({ length: Math.ceil(600 / 7) + 1 }, (_, i) => [Math.min(-150 + 7 * i, 450), 0])
    const pieces = keptAlong(clip, pts)
    expect(whole.map((p) => p.map(Math.round))).toEqual([[0, 147], [453, 600]])
    expect(pieces).toHaveLength(whole.length)
    pieces.forEach((p, i) => {
      expect(Math.abs(p[0] - whole[i]![0])).toBeLessThan(CLIP_MIN_PIECE_M)
      expect(Math.abs(p[1] - whole[i]![1])).toBeLessThan(CLIP_MIN_PIECE_M)
    })
  })

  it('unions the cover of 40 near-coincident tracks, past its first list size', () => {
    // A trunk of 40 tracks a centimeter apart, starting a meter apart: 40 cover intervals for one street piece.
    const tracks = Array.from({ length: 40 }, (_, i) => line([-50 + i, 0.01 * i], [400, 0.01 * i]))
    const clip = buildRouteClip(tracks)
    expect(kept(clip, [0, 1], [300, 1])).toEqual([])
    expect(clip.covered.length).toBeGreaterThan(64)
    // The grown list still keeps a stretch past the trunk's end.
    const got = kept(clip, [300, 1], [500, 1])
    expect(got).toHaveLength(1)
    expect(got[0]![0]).toBeCloseTo(100 + CLIP_END_PAD_M, 6)
  })

  it('returns a street far from every track whole, and with no tracks at all', () => {
    expect(kept(buildRouteClip(PAIR), [5000, 5000], [5100, 5000])).toEqual([[0, 100]])
    expect(kept(buildRouteClip([]), [0, 0], [300, 0])).toEqual([[0, 300]])
  })
})
