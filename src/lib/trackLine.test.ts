import { describe, expect, it } from 'vitest'
import { deltaEncode } from '../data/codec'
import { toGround } from './projection'
import { dropSpurs, trackLine } from './trackLine'
import { offsetPolyline } from './trackOffset'

describe('dropSpurs', () => {
  it('removes the tip of an out-and-back spur', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 1 }, { x: 120, z: 0 }, { x: 200, z: 50 }]
    // 100 → 150 → 120 turns back ~178 degrees at 150.
    expect(dropSpurs(pts)).toEqual([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 120, z: 0 }, { x: 200, z: 50 }])
  })

  it('removes a spur that retraces its own vertices, repeating until none is left', () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }, { x: 30, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]
    const out = dropSpurs(pts)
    expect(out[0]).toEqual({ x: 0, z: 0 })
    expect(out.at(-1)).toEqual({ x: 10, z: 10 })
    expect(out.some((p) => p.x > 10)).toBe(false)
  })

  it('leaves a 90 degree bend and a straight line alone', () => {
    const bend = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]
    expect(dropSpurs(bend)).toEqual(bend)
    const straight = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }]
    expect(dropSpurs(straight)).toEqual(straight)
  })

  it('keeps the endpoints of a line that reverses onto itself', () => {
    const out = dropSpurs([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 0 }])
    expect(out).toEqual([{ x: 0, z: 0 }, { x: 5, z: 0 }])
  })

  it('honors minTurnDeg', () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 1 }] // a 174 degree turn
    expect(dropSpurs(pts)).toEqual(pts.filter((_, i) => i !== 1))
    expect(dropSpurs(pts, 179)).toEqual(pts)
  })
})

describe('trackLine', () => {
  it('decodes, projects and offsets a shape', () => {
    const lat = [4070000, 4071000]
    const lon = [-7400000, -7400000]
    const shape = { lat: deltaEncode(lat), lon: deltaEncode(lon) }
    const center = [0, 1].map((i) => toGround({ lat: lat[i]! / 1e5, lon: lon[i]! / 1e5 }))
    expect(trackLine(shape, 4.7)).toEqual(offsetPolyline(center, 4.7))
  })
})
