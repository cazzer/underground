import { describe, expect, it } from 'vitest'
import type { Ground } from '../projection'
import { buildPolyline, pointAtDistance, type Polyline } from '../realtime/polyline'
import { MAX_CARS, type Consist } from './consist'
import { createConsistScratch, writeConsist, type CarFrame } from './consistLayout'

const FRAME: CarFrame = { gapM: 1.2, rimM: 0.5, widthM: 3, crossScale: 1, y: 0.5 }
const TEN: Consist = { cars: 10, pitchM: 15.5 }

interface Car {
  x: number
  z: number
  dx: number
  dz: number
  length: number
  scale: number
}

function layout(line: Polyline, shown: number, consist = TEN, mix = 1, slot = 0, k = 1) {
  const size = (slot + 1) * MAX_CARS * 16
  const bodies = new Float32Array(size).fill(7)
  const halos = new Float32Array(size).fill(7)
  writeConsist(bodies, halos, slot, line, shown, consist, mix, k, 1, FRAME, createConsistScratch())
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
      scale: bodies[o + 5]!,
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

  it('collapses to the dot point at mix = 0, keeping the body section', () => {
    const line = arc(100, 50)
    const dot = pointAtDistance(line, 60).point
    const { cars } = layout(line, 60, TEN, 0)
    for (const car of cars) {
      expect(car.x).toBeCloseTo(dot.x, 4)
      expect(car.z).toBeCloseTo(dot.z, 4)
      expect(car.length).toBe(0)
      expect(car.scale).toBe(1)
    }
  })

  it('shrinks to nothing at the dot point when the slot has faded (k = 0)', () => {
    const line = arc(100, 50)
    const dot = pointAtDistance(line, 60).point
    const { cars, halos } = layout(line, 60, TEN, 1, 0, 0)
    for (const car of cars) {
      expect(car.x).toBeCloseTo(dot.x, 4)
      expect(car.length).toBe(0)
      expect(car.scale).toBe(0)
    }
    for (let c = 0; c < MAX_CARS; c++) {
      expect(halos[c * 16]).toBeCloseTo(0, 9)
      expect(halos[c * 16 + 10]).toBeCloseTo(0, 9)
    }
  })

  it('widens the section by crossScale without changing the spacing', () => {
    const bodies = new Float32Array(MAX_CARS * 16)
    const halos = new Float32Array(MAX_CARS * 16)
    writeConsist(bodies, halos, 0, straight(1000), 500, TEN, 1, 1, 1, { ...FRAME, crossScale: 2 }, createConsistScratch())
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
  })

  it('zeroes the instances past the consist and leaves other slots alone', () => {
    const { bodies, halos } = layout(straight(1000), 500, { cars: 4, pitchM: 22.9 }, 1, 1)
    expect(bodies.subarray(0, MAX_CARS * 16).every((v) => v === 7)).toBe(true)
    expect(bodies.subarray((MAX_CARS + 4) * 16).every((v) => v === 0)).toBe(true)
    expect(halos.subarray((MAX_CARS + 4) * 16).every((v) => v === 0)).toBe(true)
    expect(bodies[(MAX_CARS + 3) * 16 + 15]).toBe(1)
  })
})
