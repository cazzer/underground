import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { writeInstanceMatrix, writeMarkerMatrices } from './markerMatrices'

const composed = (x: number, y: number, z: number, s: number) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(s, s, s)).elements

describe('writeMarkerMatrices', () => {
  it('matches Matrix4.compose for a scaled, translated instance', () => {
    const out = new Float32Array(16).fill(7)
    writeMarkerMatrices(out, [{ x: 12, z: -30 }], 0.2, 5, -1, 1.4)
    expect([...out]).toEqual(composed(12, 0.2, -30, 5).map(Math.fround))
  })

  it('scales the focused instance by the focus scale', () => {
    const out = new Float32Array(32)
    writeMarkerMatrices(out, [{ x: 0, z: 0 }, { x: 1, z: 1 }], 0, 10, 1, 1.5)
    expect(out[0]).toBe(10)
    expect(out[16]).toBe(15)
    expect(out[16 + 10]).toBe(15)
  })

  it('writes in place and leaves elements past the count untouched', () => {
    const out = new Float32Array(32).fill(9)
    const ref = out
    writeMarkerMatrices(out, [{ x: 1, z: 2 }], 0, 1, -1, 1)
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
