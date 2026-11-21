import { describe, expect, it } from 'vitest'
import type { Ground } from '../projection'
import { buildPolyline, pointAtDistance, type Polyline } from '../realtime/polyline'
import { MAX_CARS, type Consist } from './consist'
import { consistSpanInto, createConsistScratch, writeConsist, type CarFrame } from './consistLayout'
import { buildTrackProfile, EMPTY_PROFILE, GRADE, resampleAt, type TrackProfile } from '../trackProfile'
import { rampBreaks } from '../rampSampling'
import { createBandView } from '../bandOffset'
import { createTrackPoint, trackPointInto, type DrawnTrack } from './trackPoint'

/** An unbanded track (no miters, so the band view leaves it where it is), and a view that shifts nothing. */
/** The drawn track: the line resampled through its ramps, as network.ts draws it. */
const track = (line: Polyline, profile: TrackProfile = EMPTY_PROFILE): DrawnTrack => {
  const drawn = buildPolyline(resampleAt(line.points, line.cumulative, rampBreaks(profile)).points)
  return { line: drawn, profile, bandInputs: new Float32Array(drawn.points.length * 4) }
}
const VIEW = createBandView()

const FRAME: CarFrame = { gapM: 1.2, rimM: 0.5, widthM: 3, crossScale: 1, y: 0.5, extrude: 1 }
const TEN: Consist = { cars: 10, pitchM: 15.5 }

interface Car {
  x: number
  z: number
  dx: number
  dz: number
  length: number
  width: number
  height: number
}

function layout(line: Polyline, shown: number, consist = TEN, mix = 1, slot = 0, k = 1, profile: TrackProfile = EMPTY_PROFILE) {
  const size = (slot + 1) * MAX_CARS * 16
  const bodies = new Float32Array(size).fill(7)
  const halos = new Float32Array(size).fill(7)
  writeConsist(bodies, halos, slot, track(line, profile), VIEW, shown, consist, mix, k, 1, FRAME, createConsistScratch())
  const cars: Car[] = []
  for (let c = 0; c < consist.cars; c++) {
    const o = (slot * MAX_CARS + c) * 16
    const length = Math.hypot(bodies[o + 8]!, bodies[o + 10]!)
    cars.push({
      x: bodies[o + 12]!,
      z: bodies[o + 14]!,
      dx: length > 0 ? bodies[o + 8]! / length : 0,
      dz: length > 0 ? bodies[o + 10]! / length : 0,
      length,
      width: Math.hypot(bodies[o]!, bodies[o + 2]!),
      height: bodies[o + 5]!,
    })
  }
  return { bodies, halos, cars }
}

const straight = (length: number) =>
  buildPolyline([
    { x: 0, z: 0 },
    { x: length, z: 0 },
  ])

/** A quarter circle around the origin, from north to east. */
function arc(radius: number, steps: number): Polyline {
  const pts: Ground[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2)
    pts.push({ x: radius * Math.sin(a), z: -radius * Math.cos(a) })
  }
  return buildPolyline(pts)
}

describe('writeConsist', () => {
  it('spaces cars one pitch apart along a straight line, facing forward', () => {
    const { cars } = layout(straight(1000), 500)
    for (let c = 1; c < cars.length; c++) expect(cars[c]!.x - cars[c - 1]!.x).toBeCloseTo(15.5, 3)
    expect((cars[0]!.x + cars[9]!.x) / 2).toBeCloseTo(500, 3)
    for (const car of cars) {
      expect(car.dx).toBeCloseTo(1, 6)
      expect(car.length).toBeCloseTo(15.5 - 1.2, 4)
    }
  })

  it('keeps cars on a quarter circle within the sagitta and without overlap', () => {
    const r = 100
    const line = arc(r, 400)
    const { cars } = layout(line, line.length / 2)
    const sagitta = r - Math.sqrt(r * r - (15.5 / 2) ** 2)
    for (const car of cars) {
      const off = r - Math.hypot(car.x, car.z)
      expect(off).toBeGreaterThanOrEqual(-0.01)
      expect(off).toBeLessThanOrEqual(sagitta + 0.01)
    }
    for (let c = 1; c < cars.length; c++) {
      const p = cars[c - 1]!
      const q = cars[c]!
      const frontX = p.x + (p.dx * p.length) / 2
      const frontZ = p.z + (p.dz * p.length) / 2
      const rearX = q.x - (q.dx * q.length) / 2
      const rearZ = q.z - (q.dz * q.length) / 2
      expect((rearX - frontX) * p.dx + (rearZ - frontZ) * p.dz).toBeGreaterThan(0)
    }
  })

  it('collapses to the dot point at mix = 0, keeping the body width', () => {
    const line = arc(100, 50)
    const dot = pointAtDistance(line, 60).point
    const { cars } = layout(line, 60, TEN, 0)
    for (const car of cars) {
      expect(car.x).toBeCloseTo(dot.x, 4)
      expect(car.z).toBeCloseTo(dot.z, 4)
      expect(car.length).toBe(0)
      expect(car.width).toBeCloseTo(1, 6)
      expect(car.height).toBe(0)
    }
  })

  it('ramps the body height in over the first quarter of the handoff', () => {
    const heights = [0.05, 0.125, 0.25, 0.6].map((mix) => layout(straight(1000), 500, TEN, mix).cars[0]!.height)
    expect(heights.map((h) => +h.toFixed(6))).toEqual([0.2, 0.5, 1, 1])
  })

  it('scales the body height by extrude: flat footprints at 0, at the same place and size', () => {
    const write = (extrude: number) => {
      const bodies = new Float32Array(MAX_CARS * 16)
      const halos = new Float32Array(MAX_CARS * 16)
      writeConsist(bodies, halos, 0, track(straight(1000)), VIEW, 500, TEN, 1, 1, 1, { ...FRAME, extrude }, createConsistScratch())
      return { bodies, halos }
    }
    const full = write(1)
    const flat = write(0)
    const half = write(0.5)
    for (let c = 0; c < TEN.cars; c++) {
      const o = c * 16
      expect(flat.bodies[o + 5]).toBe(0)
      expect(half.bodies[o + 5]).toBeCloseTo(full.bodies[o + 5]! / 2, 6)
      for (const j of [0, 2, 8, 10, 12, 13, 14]) expect(flat.bodies[o + j]).toBeCloseTo(full.bodies[o + j]!, 6)
    }
    expect(flat.halos).toEqual(full.halos)
  })

  it('shrinks to nothing at the dot point when the slot has faded (k = 0)', () => {
    const line = arc(100, 50)
    const dot = pointAtDistance(line, 60).point
    const { cars, halos } = layout(line, 60, TEN, 1, 0, 0)
    for (const car of cars) {
      expect(car.x).toBeCloseTo(dot.x, 4)
      expect(car.length).toBe(0)
      expect(car.width).toBe(0)
      expect(car.height).toBe(0)
    }
    for (let c = 0; c < MAX_CARS; c++) {
      expect(halos[c * 16]).toBeCloseTo(0, 9)
      expect(halos[c * 16 + 10]).toBeCloseTo(0, 9)
    }
  })

  it('widens the section by crossScale without changing the spacing', () => {
    const bodies = new Float32Array(MAX_CARS * 16)
    const halos = new Float32Array(MAX_CARS * 16)
    writeConsist(bodies, halos, 0, track(straight(1000)), VIEW, 500, TEN, 1, 1, 1, { ...FRAME, crossScale: 2 }, createConsistScratch())
    expect(bodies[5]).toBe(2)
    expect(bodies[16 + 12]! - bodies[12]!).toBeCloseTo(15.5, 3)
  })

  it('keeps every car on the shape at a terminal and on a shape shorter than the train', () => {
    const cases: [number, number][] = [
      [1000, 1000],
      [1000, 0],
      [50, 40],
    ]
    for (const [length, shown] of cases) {
      const { cars } = layout(straight(length), shown)
      for (const car of cars) {
        expect(car.x - car.length / 2).toBeGreaterThanOrEqual(-1e-3)
        expect(car.x + car.length / 2).toBeLessThanOrEqual(length + 1e-3)
      }
    }
  })

  it('writes finite matrices for a zero-length line', () => {
    const line = buildPolyline([
      { x: 5, z: 5 },
      { x: 5, z: 5 },
    ])
    const { bodies, halos } = layout(line, 0)
    expect(bodies.every(Number.isFinite)).toBe(true)
    expect(halos.every(Number.isFinite)).toBe(true)
    // The chord is zero, so cars face north (0, -1): a non-negative length keeps the z column at or below 0.
    expect(bodies[10]).toBeLessThanOrEqual(0)
  })

  it('widens car length without closing the gap between cars', () => {
    const bodies = new Float32Array(MAX_CARS * 16)
    const halos = new Float32Array(MAX_CARS * 16)
    const b60: Consist = { cars: 8, pitchM: 18.3 }
    writeConsist(bodies, halos, 0, track(straight(1000)), VIEW, 500, b60, 1, 1, 1.075, FRAME, createConsistScratch())
    const length = Math.hypot(bodies[8]!, bodies[10]!)
    expect(length).toBeGreaterThan(18.3 - 1.2)
    expect(length).toBeLessThanOrEqual(18.3 - 0.6 + 1e-4)
  })

  it('rides the profile: chord ends at track height, each car pitched down a ramp and level at the platform', () => {
    const line = straight(1000)
    const profile = buildTrackProfile([{ d0: 700, d1: 900, yReal: -10.2 }], { grade: GRADE, yScale: 2 }).profile
    const len = (o: number, b: Float32Array) => Math.hypot(b[o + 8]!, b[o + 9]!, b[o + 10]!)
    const onRamp = layout(line, 530, TEN, 1, 0, 1, profile)
    const s = consistSpanInto({ cars: 0, pitch: 0, step: 0, rear: 0 }, 1000, 530, TEN, 1)
    for (let c = 0; c < TEN.cars; c++) {
      const o = c * 16
      // Chord ends sit on the drawn line (trackPointInto), which follows the eased profile within the ramp tolerance.
      const drawnY = (d: number) => trackPointInto(track(line, profile), d, VIEW, createTrackPoint()).y
      const [ya, yb] = [drawnY(s.rear + c * s.step), drawnY(s.rear + (c + 1) * s.step)]
      expect(onRamp.bodies[o + 13]).toBeCloseTo((ya + yb) / 2 + FRAME.y, 4)
      expect(onRamp.halos[o + 13]).toBeCloseTo((ya + yb) / 2 + FRAME.y, 4)
      // Forward points down the ramp along the chord; up tilts back so it stays perpendicular.
      expect(onRamp.bodies[o + 9]! / len(o, onRamp.bodies)).toBeCloseTo((yb - ya) / Math.hypot(s.step, yb - ya), 4)
      expect(onRamp.bodies[o + 9]!).toBeLessThan(0)
      expect(onRamp.bodies[o + 5]!).toBeGreaterThan(0)
    }
    const atPlatform = layout(line, 800, TEN, 1, 0, 1, profile)
    for (let c = 0; c < TEN.cars; c++) {
      expect(atPlatform.bodies[c * 16 + 13]).toBeCloseTo(-20.4 + FRAME.y, 4)
      expect(atPlatform.bodies[c * 16 + 9]).toBeCloseTo(0, 6)
    }
  })

  it('zeroes the instances past the consist and leaves other slots alone', () => {
    const { bodies, halos } = layout(straight(1000), 500, { cars: 4, pitchM: 22.9 }, 1, 1)
    expect(bodies.subarray(0, MAX_CARS * 16).every((v) => v === 7)).toBe(true)
    expect(bodies.subarray((MAX_CARS + 4) * 16).every((v) => v === 0)).toBe(true)
    expect(halos.subarray((MAX_CARS + 4) * 16).every((v) => v === 0)).toBe(true)
    expect(bodies[(MAX_CARS + 3) * 16 + 15]).toBe(1)
  })
})

describe('consistSpanInto', () => {
  const span = () => ({ cars: 0, pitch: 0, step: 0, rear: 0 })

  it('spans exactly the chords the cars are drawn on', () => {
    for (const [mix, shown] of [
      [1, 500],
      [0.4, 500],
      [1, 20],
    ] as const) {
      const { cars } = layout(straight(1000), shown, TEN, mix)
      const s = consistSpanInto(span(), 1000, shown, TEN, mix)
      expect(s.cars).toBe(10)
      expect(cars[0]!.x - s.step / 2).toBeCloseTo(s.rear, 4)
      expect(cars[9]!.x + s.step / 2).toBeCloseTo(s.rear + s.cars * s.step, 4)
    }
  })

  it('collapses to the dot at mix 0 and fits a shape shorter than the train', () => {
    expect(consistSpanInto(span(), 1000, 300, TEN, 0)).toEqual({ cars: 10, pitch: 15.5, step: 0, rear: 300 })
    const short = consistSpanInto(span(), 50, 40, TEN, 1)
    expect(short.rear).toBeCloseTo(0, 6)
    expect(short.rear + short.cars * short.step).toBeCloseTo(50, 6)
  })
})
