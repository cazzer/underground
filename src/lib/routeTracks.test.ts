import { describe, expect, it } from 'vitest'
import { distinctTracks, localTracks, packTracks, unpackTracks } from './routeTracks'

const shape = (...xz: [number, number][]) => ({ points: xz.map(([x, z]) => ({ x, z })) })

describe('packTracks', () => {
  it('round-trips through unpackTracks, empty tracks included', () => {
    const shapes = [shape([0, 0], [10.5, -3]), shape(), shape([100, 200], [101, 201], [102, 203])]
    expect(unpackTracks(packTracks(shapes))).toEqual(shapes.map((s) => s.points))
  })

  it('packs each ground path once', () => {
    const a = shape([0, 0], [10, 0])
    const packed = packTracks([a, shape([0, 0], [10, 0]), shape([0, 0], [10, 1]), a])
    expect(unpackTracks(packed)).toEqual([a.points, [{ x: 0, z: 0 }, { x: 10, z: 1 }]])
    expect(distinctTracks([a, shape([0, 0], [10, 0])])).toEqual([a])
  })

  it('rejects a non-finite coordinate', () => {
    expect(() => unpackTracks({ xz: new Float32Array([0, 0, NaN, 1]), starts: new Int32Array([0, 2]) })).toThrow(/coordinate 2 is NaN/)
    expect(() => unpackTracks({ xz: new Float32Array([0, Infinity]), starts: new Int32Array([0, 1]) })).toThrow(/coordinate 1/)
  })

  it('rejects a pack whose starts do not match its points', () => {
    expect(() => unpackTracks({ xz: new Float32Array(4), starts: new Int32Array([0, 3]) })).toThrow(/Packed tracks/)
    expect(() => unpackTracks({ xz: new Float32Array(4), starts: new Int32Array([0, 3, 2]) })).toThrow(/before it starts/)
  })
})

describe('localTracks', () => {
  it('keeps only the runs of segments within reach of the anchor, in meters from it', () => {
    // East along z = 0 from x = -1000 to 1000 in 100 m steps, then away north; the anchor sits at (1000, 50).
    const xs = Array.from({ length: 21 }, (_, i) => -1000 + 100 * i)
    const s = shape(...xs.map((x): [number, number] => [x, 0]), [1000, -1000])
    // Within 250 m: the segments from x = 700 on, and the stretch north, which starts 50 m off.
    expect(localTracks([s], { x: 1000, z: 50 }, 250)).toEqual([[...[700, 800, 900, 1000].map((x) => ({ x: x - 1000, z: -50 })), { x: 0, z: -1050 }]])
  })

  it('splits a shape that leaves the reach and comes back into two runs', () => {
    const s = shape([-10, 0], [10, 0], [10, 500], [-10, 500], [-10, 1])
    expect(localTracks([s], { x: 0, z: 0 }, 50)).toEqual([
      [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 500 }],
      [{ x: -10, z: 500 }, { x: -10, z: 1 }],
    ])
  })
})
