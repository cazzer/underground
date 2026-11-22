import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { writeInstanceMatrix, writeMarkerMatrices, writeChordMatrix } from './markerMatrices'

const composed = (x: number, y: number, z: number, s: number) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(s, s, s)).elements

describe('writeMarkerMatrices', () => {
  it('matches Matrix4.compose for a scaled, translated instance', () => {
    const out = new Float32Array(16).fill(7)
    writeMarkerMatrices(out, [{ x: 12, z: -30 }], 0.2, 5, [])
    expect([...out]).toEqual(composed(12, 0.2, -30, 5).map(Math.fround))
  })

  it('collapses every hidden instance to scale 0 at its own position, and no other', () => {
    const out = new Float32Array(48)
    writeMarkerMatrices(out, [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 3 }], 0.2, 10, [2, 0])
    expect(out[0]).toBe(0)
    expect(out[16]).toBe(10)
    expect(out[16 + 10]).toBe(10)
    expect([out[32], out[32 + 5], out[32 + 10], out[32 + 12], out[32 + 14], out[32 + 15]]).toEqual([0, 0, 0, 2, 3, 1])
  })

  it('ignores a hidden index past the positions', () => {
    const out = new Float32Array(16)
    writeMarkerMatrices(out, [{ x: 0, z: 0 }], 0, 4, [3])
    expect(out[0]).toBe(4)
  })

  it('writes in place and leaves elements past the count untouched', () => {
    const out = new Float32Array(32).fill(9)
    const ref = out
    writeMarkerMatrices(out, [{ x: 1, z: 2 }], 0, 1, [])
    expect(out).toBe(ref)
    expect([...out.subarray(16)]).toEqual(new Array(16).fill(9))
  })
})

describe('writeInstanceMatrix', () => {
  it('matches Matrix4.compose and touches only its instance', () => {
    const out = new Float32Array(48).fill(9)
    writeInstanceMatrix(out, 1, 4, 0.5, -8, 2.5)
    expect([...out.subarray(16, 32)]).toEqual(composed(4, 0.5, -8, 2.5).map(Math.fround))
    expect([...out.subarray(0, 16)]).toEqual(new Array(16).fill(9))
    expect([...out.subarray(32)]).toEqual(new Array(16).fill(9))
  })
})

describe('writeChordMatrix', () => {
  const apply = (m: Float32Array, o: number, x: number, y: number, z: number) => [
    m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!,
    m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!,
    m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!,
  ]
  const column = (m: Float32Array, c: number) => [m[4 * c]!, m[4 * c + 1]!, m[4 * c + 2]!]
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

  it('maps local forward onto the direction and keeps a positive determinant', () => {
    const out = new Float32Array(32)
    writeChordMatrix(out, 1, 10, 2, -5, 3, 0, 4, 1, 1, 1)
    const [x, y, z] = apply(out, 16, 0, 0, 1)
    expect(x! - 10).toBeCloseTo(0.6, 6)
    expect(y).toBeCloseTo(2, 6)
    expect(z! + 5).toBeCloseTo(0.8, 6)
    expect(new Matrix4().fromArray(out, 16).determinant()).toBeCloseTo(1, 5)
    writeChordMatrix(out, 0, 0, 0, 0, -1, 0, 0.2, 2, 3, 4)
    expect(new Matrix4().fromArray(out, 0).determinant()).toBeCloseTo(24, 4)
  })

  it('is a yaw about +y for a level chord', () => {
    const out = new Float32Array(16)
    writeChordMatrix(out, 0, 1, 2, 3, 3, 0, 4, 2, 5, 7)
    const [fx, fz] = [0.6, 0.8]
    const yaw = [2 * fz, 0, -2 * fx, 0, 0, 5, 0, 0, 7 * fx, 0, 7 * fz, 0, 1, 2, 3, 1]
    yaw.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6))
  })

  it('pitches along a sloped chord: orthonormal axes times the scales, x level, y up', () => {
    const out = new Float32Array(16)
    writeChordMatrix(out, 0, 0, 0, 0, 30, -2, -40, 2, 3, 4)
    const [cx, cy, cz] = [column(out, 0), column(out, 1), column(out, 2)]
    expect(Math.hypot(...cx)).toBeCloseTo(2, 6)
    expect(Math.hypot(...cy)).toBeCloseTo(3, 6)
    expect(Math.hypot(...cz)).toBeCloseTo(4, 6)
    expect(dot(cx, cy)).toBeCloseTo(0, 6)
    expect(dot(cy, cz)).toBeCloseTo(0, 6)
    expect(dot(cx, cz)).toBeCloseTo(0, 6)
    expect(cx[1]).toBe(0)
    expect(cy[1]).toBeGreaterThan(0)
    const len = Math.hypot(30, -2, -40)
    cz.forEach((v, i) => expect(v).toBeCloseTo((4 * [30, -2, -40][i]!) / len, 6))
    expect(new Matrix4().fromArray(out, 0).determinant()).toBeCloseTo(24, 4)
  })

  it('applies the per-axis scales', () => {
    const out = new Float32Array(16)
    writeChordMatrix(out, 0, 0, 0, 0, 1, 0, 0, 2, 3, 4)
    expect(apply(out, 0, 0, 0, 1)).toEqual([4, 0, 0])
    expect(apply(out, 0, 0, 1, 0)).toEqual([0, 3, 0])
    expect(Math.hypot(...apply(out, 0, 1, 0, 0))).toBeCloseTo(2, 6)
  })

  it('faces north for a zero direction and stays finite and right-handed for a vertical one', () => {
    const out = new Float32Array(16)
    writeChordMatrix(out, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1)
    const [x, , z] = apply(out, 0, 0, 0, 1)
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(-1, 6)
    expect(out.every(Number.isFinite)).toBe(true)
    writeChordMatrix(out, 0, 0, 0, 0, 0, -5, 0, 1, 2, 3)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(apply(out, 0, 0, 0, 1)).toEqual([0, -3, 0])
    expect(new Matrix4().fromArray(out, 0).determinant()).toBeCloseTo(6, 5)
  })
})
