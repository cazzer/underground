import { describe, expect, it } from 'vitest'
import { tiltT } from '../tilt'
import { carMix, carsReach, CARS_AT_M, consistCenter, consistFor, DEFAULT_CONSIST, DOTS_FROM_M, MAX_CARS } from './consist'

describe('consistFor', () => {
  it('gives each division its car count and length', () => {
    expect(consistFor('1')).toEqual({ cars: 10, pitchM: 15.5 })
    expect(consistFor('6X')).toEqual({ cars: 10, pitchM: 15.5 })
    expect(consistFor('7')).toEqual({ cars: 11, pitchM: 15.5 })
    expect(consistFor('L')).toEqual({ cars: 8, pitchM: 18.3 })
    expect(consistFor('M')).toEqual({ cars: 8, pitchM: 18.3 })
    expect(consistFor('G')).toEqual({ cars: 5, pitchM: 18.3 })
    expect(consistFor('SI')).toEqual({ cars: 4, pitchM: 22.9 })
    expect(consistFor('FS')).toEqual({ cars: 2, pitchM: 22.9 })
    expect(consistFor('A')).toEqual({ cars: 10, pitchM: 18.3 })
  })

  it('falls back to the default for unknown or missing routes', () => {
    expect(consistFor('QQ')).toBe(DEFAULT_CONSIST)
    expect(consistFor(null)).toBe(DEFAULT_CONSIST)
  })

  it('never exceeds MAX_CARS', () => {
    for (const r of ['1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS', 'L', 'J', 'Z', 'M', 'G', 'FS', 'H', 'SI', 'A', 'N']) {
      expect(consistFor(r).cars).toBeLessThanOrEqual(MAX_CARS)
    }
  })
})

describe('consistCenter', () => {
  it('centers the train on the dot mid-shape', () => {
    expect(consistCenter(1000, 400, 150)).toBe(400)
  })

  it('pulls the train back onto the shape near either end', () => {
    expect(consistCenter(1000, 1000, 150)).toBe(925)
    expect(consistCenter(1000, 10, 150)).toBe(75)
  })

  it('centers a train longer than its shape on the shape', () => {
    expect(consistCenter(50, 45, 150)).toBe(25)
    expect(consistCenter(150, 140, 150)).toBe(75)
  })

  it('is the dot itself for a zero-length train', () => {
    expect(consistCenter(1000, 1000, 0)).toBe(1000)
  })
})

describe('carMix', () => {
  it('is 0 for dots and 1 for cars at the ends', () => {
    expect(carMix(DOTS_FROM_M)).toBeCloseTo(0, 12)
    expect(carMix(5000)).toBe(0)
    expect(carMix(CARS_AT_M)).toBeCloseTo(1, 12)
    expect(carMix(200)).toBe(1)
  })

  it('rises monotonically as the camera comes in', () => {
    let prev = -1
    for (let d = 3000; d >= 500; d -= 5) {
      const m = carMix(d)
      expect(m).toBeGreaterThanOrEqual(prev)
      prev = m
    }
  })

  it('is continuous at both thresholds', () => {
    for (const d of [CARS_AT_M, DOTS_FROM_M]) {
      expect(Math.abs(carMix(d - 0.01) - carMix(d + 0.01))).toBeLessThan(1e-6)
    }
  })
})

describe('stage distances', () => {
  it('trains are footprints (cars) by the time the camera starts to tilt, and only dots before 2400 m', () => {
    expect(DOTS_FROM_M).toBe(2400)
    expect(CARS_AT_M).toBe(1600)
    expect(carMix(1400)).toBe(1)
    expect(tiltT(1400)).toBe(0)
  })
})

describe('carsReach', () => {
  it('is three camera distances plus 300 m at full tilt and one plus 300 m top-down', () => {
    expect(carsReach(1000, 1)).toBe(3300)
    expect(carsReach(1000, 0)).toBe(1300)
  })

  it('grows with tilt at a fixed distance, and with distance at a fixed tilt', () => {
    expect(carsReach(800, 0.5)).toBeGreaterThan(carsReach(800, 0.2))
    expect(carsReach(900, 0.5)).toBeGreaterThan(carsReach(800, 0.5))
  })
})
