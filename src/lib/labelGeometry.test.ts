import { describe, expect, it } from 'vitest'
import { BOX, boxesOverlap, boxHitsRect, boxInRect, RECT, uprightAngle, UPRIGHT_HYSTERESIS, writeBox, writeRect } from './labelGeometry'

const boxes = (n: number) => new Float32Array(n * BOX)

function rect(left: number, top: number, right: number, bottom: number): Float32Array {
  const r = new Float32Array(RECT)
  writeRect(r, 0, left, top, right, bottom)
  return r
}

describe('uprightAngle', () => {
  it('keeps text reading left to right', () => {
    expect(uprightAngle(1, 0)).toBe(0)
    expect(uprightAngle(-1, 0)).toBeCloseTo(0)
    expect(uprightAngle(1, 1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, -1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, 1)).toBeCloseTo(-Math.PI / 4)
  })

  it('wraps vertical directions into (-π/2, π/2]', () => {
    expect(uprightAngle(0, 1)).toBeCloseTo(Math.PI / 2)
    expect(uprightAngle(0, -1)).toBeCloseTo(Math.PI / 2)
  })

  it('keeps its reading direction a little past vertical, then flips', () => {
    const steep = Math.PI / 2 - 0.05
    // The street turns 0.1 rad past vertical: without history it would flip to read the other way.
    const past = Math.PI / 2 + 0.05
    expect(uprightAngle(Math.cos(past), Math.sin(past))).toBeCloseTo(past - Math.PI)
    expect(uprightAngle(Math.cos(past), Math.sin(past), steep)).toBeCloseTo(past)
    // Past the hysteresis it flips.
    const far = Math.PI / 2 + UPRIGHT_HYSTERESIS + 0.02
    expect(uprightAngle(Math.cos(far), Math.sin(far), past)).toBeCloseTo(far - Math.PI)
    // Far from vertical, the history changes nothing.
    expect(uprightAngle(1, 0.1, Math.PI / 2)).toBeCloseTo(Math.atan(0.1))
  })
})

describe('writeBox', () => {
  it('writes the four corners around the center, turned clockwise on screen, and its bounds', () => {
    const b = boxes(1)
    writeBox(b, 0, 10, 20, 8, 2, 0)
    expect([...b.slice(0, 12)]).toEqual([6, 19, 14, 19, 14, 21, 6, 21, 6, 19, 14, 21])
    writeBox(b, 0, 0, 0, 8, 2, Math.PI / 2)
    // Turned a quarter clockwise (y down), the long side runs down the screen.
    expect(b[11]! - b[9]!).toBeCloseTo(8)
    expect(b[10]! - b[8]!).toBeCloseTo(2)
  })
})

describe('boxesOverlap', () => {
  it('separates axis-aligned boxes apart by more than the pad', () => {
    const b = boxes(2)
    writeBox(b, 0, 0, 0, 10, 4, 0)
    writeBox(b, 1, 13, 0, 10, 4, 0)
    expect(boxesOverlap(b, 0, 1, 2)).toBe(false)
    expect(boxesOverlap(b, 0, 1, 4)).toBe(true)
    writeBox(b, 1, 9, 0, 10, 4, 0)
    expect(boxesOverlap(b, 0, 1, 0)).toBe(true)
  })

  it('sees past the bounding boxes of turned boxes', () => {
    const b = boxes(2)
    // Two long thin boxes on parallel diagonals: their bounding boxes overlap, they don't.
    writeBox(b, 0, 0, 0, 100, 4, Math.PI / 4)
    writeBox(b, 1, 20, -20, 100, 4, Math.PI / 4)
    expect(boxesOverlap(b, 0, 1, 2)).toBe(false)
    // A crossing pair does.
    writeBox(b, 1, 0, 0, 100, 4, -Math.PI / 4)
    expect(boxesOverlap(b, 0, 1, 2)).toBe(true)
  })
})

describe('boxInRect and boxHitsRect', () => {
  it('requires every corner inside', () => {
    const b = boxes(1)
    writeBox(b, 0, 50, 25, 20, 10, 0)
    expect(boxInRect(b, 0, 0, 0, 100, 50)).toBe(true)
    writeBox(b, 0, 95, 25, 20, 10, 0)
    expect(boxInRect(b, 0, 0, 0, 100, 50)).toBe(false)
  })

  it('tests a turned box against the rect, not its bounds', () => {
    const b = boxes(1)
    const r = rect(0, 0, 100, 50)
    // A diagonal box whose bounding box reaches into the rect's corner while the box itself passes it by.
    writeBox(b, 0, 115, -15, 60, 4, Math.PI / 4)
    expect(boxHitsRect(b, 0, r, 0)).toBe(false)
    writeBox(b, 0, 100, 0, 60, 4, -Math.PI / 4)
    expect(boxHitsRect(b, 0, r, 0)).toBe(true)
  })

  it('touches nothing for an empty rect', () => {
    const b = boxes(1)
    writeBox(b, 0, 0, 0, 10, 10, 0)
    expect(boxHitsRect(b, 0, rect(0, 0, 0, 0), 0)).toBe(false)
  })
})
