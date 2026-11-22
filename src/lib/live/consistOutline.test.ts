import { describe, expect, it } from 'vitest'
import { createBandView } from '../bandOffset'
import { CAR_HEIGHT_M, CAR_WIDTH_M } from '../carDims'
import { buildPolyline } from '../realtime/polyline'
import { EMPTY_PROFILE } from '../trackProfile'
import { MAX_CARS, type Consist } from './consist'
import { createConsistScratch, writeConsist, writeEndCaps, type CarFrame } from './consistLayout'
import type { DrawnTrack } from './trackPoint'

/** A straight unbanded track along +x, and a view that shifts nothing. */
const STRAIGHT = buildPolyline([
  { x: 0, z: 0 },
  { x: 1000, z: 0 },
])
const TRACK: DrawnTrack = { line: STRAIGHT, profile: EMPTY_PROFILE, bandInputs: new Float32Array(STRAIGHT.points.length * 4) }
const VIEW = createBandView()
const FRAME: CarFrame = { gapM: 1.2, rimM: 0.5, widthM: 3, crossScale: 1, y: 0.5, extrude: 1 }
const TEN: Consist = { cars: 10, pitchM: 15.5 }

describe('writeConsist outline shells', () => {
  it('grows outline shells around the bodies and joins them across the gaps', () => {
    const write = (outlineM?: number) => {
      const bodies = new Float32Array(MAX_CARS * 16)
      const frame = { ...FRAME, outlineM }
      writeConsist(bodies, new Float32Array(MAX_CARS * 16), 0, TRACK, VIEW, 500, TEN, 1, 1, 1, frame, createConsistScratch())
      // The cars run along +x: each one's [rear, front] in x, its section in meters and its floor height.
      return Array.from({ length: TEN.cars }, (_, c) => {
        const o = c * 16
        const half = Math.hypot(bodies[o + 8]!, bodies[o + 10]!) / 2
        return { rear: bodies[o + 12]! - half, front: bodies[o + 12]! + half, width: Math.hypot(bodies[o]!, bodies[o + 2]!) * CAR_WIDTH_M, height: bodies[o + 5]! * CAR_HEIGHT_M, y: bodies[o + 13]! }
      })
    }
    const body = write()
    const shell = write(0.3)
    for (let c = 0; c < TEN.cars; c++) {
      expect(shell[c]!.width).toBeCloseTo(body[c]!.width + 0.6, 4)
      expect(shell[c]!.height).toBeCloseTo(body[c]!.height + 0.6, 4)
      expect(shell[c]!.y).toBeCloseTo(body[c]!.y - 0.3, 4)
    }
    // The train's two ends grow by the outline; at each joint the shells overlap, past the gap's middle.
    expect(shell[0]!.rear).toBeCloseTo(body[0]!.rear - 0.3, 4)
    expect(shell[TEN.cars - 1]!.front).toBeCloseTo(body[TEN.cars - 1]!.front + 0.3, 4)
    for (let c = 0; c + 1 < TEN.cars; c++) {
      const middle = (body[c]!.front + body[c + 1]!.rear) / 2
      expect(shell[c]!.front).toBeGreaterThan(middle)
      expect(shell[c + 1]!.rear).toBeLessThan(middle)
      expect(shell[c]!.front - shell[c + 1]!.rear).toBeLessThan(1)
    }
  })
})

describe('writeEndCaps', () => {
  /** Where a matrix sends a local point. */
  const apply = (m: Float32Array, o: number, x: number, y: number, z: number) => [0, 1, 2].map((r) => m[o + r]! * x + m[o + 4 + r]! * y + m[o + 8 + r]! * z + m[o + 12 + r]!)
  const det3 = (m: Float32Array, o: number) =>
    m[o]! * (m[o + 5]! * m[o + 10]! - m[o + 9]! * m[o + 6]!) - m[o + 4]! * (m[o + 1]! * m[o + 10]! - m[o + 9]! * m[o + 2]!) + m[o + 8]! * (m[o + 1]! * m[o + 6]! - m[o + 5]! * m[o + 2]!)

  it("closes the rear car's rear end and the front car's front end, keeping the face's winding", () => {
    const shells = new Float32Array(MAX_CARS * 16)
    writeConsist(shells, new Float32Array(MAX_CARS * 16), 0, TRACK, VIEW, 500, TEN, 1, 1, 1, { ...FRAME, outlineM: 0.3 }, createConsistScratch())
    const caps = new Float32Array(32).fill(7)
    writeEndCaps(shells, caps)
    const last = (TEN.cars - 1) * 16
    // The cap face sits at local z = -0.5: the rear car's rear end, and (turned about y) the front car's front end.
    expect(apply(caps, 0, 0, 1, -0.5)).toEqual(apply(shells, 0, 0, 1, -0.5))
    const front = apply(caps, 16, 0, 1, -0.5)
    apply(shells, last, 0, 1, 0.5).forEach((v, r) => expect(front[r]).toBeCloseTo(v, 4))
    // A proper rotation, so its face still points out of the train (forward, +x here).
    expect(det3(caps, 16)).toBeGreaterThan(0)
    expect(apply(caps, 16, 0, 1, -1)[0]! - front[0]!).toBeGreaterThan(0)
  })

  it('zeroes both caps with no cars', () => {
    const caps = new Float32Array(32).fill(7)
    writeEndCaps(new Float32Array(MAX_CARS * 16), caps)
    expect(caps.every((v) => v === 0)).toBe(true)
  })
})
