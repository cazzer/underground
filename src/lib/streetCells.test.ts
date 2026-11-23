import { describe, expect, it } from 'vitest'
import type { LineBuffers } from './lineBuffers'
import { clipToCell, inCell, NO_CELL, streetCells, type StreetSite } from './streetCells'

/** One segment from (ax, az) to (bx, bz), colors running from 0 to 1 along it. */
function segment(ax: number, az: number, bx: number, bz: number): LineBuffers {
  return { positions: new Float32Array([ax, 0, az, bx, 0, bz]), colors: new Float32Array([0, 0, 0, 1, 1, 1]) }
}

function length(b: LineBuffers): number {
  let sum = 0
  for (let i = 0; i + 6 <= b.positions.length; i += 6) {
    sum += Math.hypot(b.positions[i + 3]! - b.positions[i]!, b.positions[i + 5]! - b.positions[i + 2]!)
  }
  return sum
}

const site = (id: string, x: number, z: number, radiusM = 300): StreetSite => ({ id, x, z, radiusM })

describe('streetCells', () => {
  it('gives a lone layer no planes, and clipping it returns the same buffers', () => {
    const [cell] = streetCells([site('A', 0, 0)])
    expect(cell).toBe(NO_CELL)
    const b = segment(-100, 0, 100, 0)
    expect(clipToCell(b, cell!)).toBe(b)
  })

  it('splits a street through two anchors 300 m apart at the bisector, colours continuous', () => {
    const [a, b] = streetCells([site('A', 0, 0), site('B', 300, 0)])
    // A street along x from -300 to 600 in scene meters: A's local is the same, B's is shifted by 300.
    const inA = clipToCell(segment(-300, 0, 600, 0), a!)
    const inB = clipToCell(segment(-600, 0, 300, 0), b!)
    expect(inA.positions[3]).toBeCloseTo(150, 6)
    expect(inB.positions[0]).toBeCloseTo(-150, 6)
    expect(length(inA) + length(inB)).toBeCloseTo(900, 6)
    // At A's cut the colour is the lerp at t = 450 / 900.
    expect(inA.colors[3]).toBeCloseTo(0.5, 6)
    expect(inB.colors[0]).toBeCloseTo(0.5, 6)
  })

  it('adds no plane for a layer whose disc doesn\'t overlap, and keys only the overlapping ones', () => {
    const [a] = streetCells([site('A', 0, 0), site('B', 300, 0), site('C', 0, 700)])
    expect(a!.key).toBe('B')
    expect(a!.planes.length).toBe(3)
    const [alone] = streetCells([site('A', 0, 0), site('C', 0, 700)])
    expect(alone).toBe(NO_CELL)
  })

  it('puts every point of the union in exactly one cell, inside its owner\'s disc, with unequal radii', () => {
    const sites = [site('A', 0, 0, 300), site('B', 250, 40, 200), site('C', 120, -260, 320), site('D', -200, 150, 260)]
    const cells = streetCells(sites)
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    let tested = 0
    for (let n = 0; n < 4000; n++) {
      const x = -600 + 1200 * rand()
      const z = -700 + 1200 * rand()
      const holders = sites.filter((s) => Math.hypot(x - s.x, z - s.z) <= s.radiusM)
      if (holders.length === 0) continue
      tested++
      const owners = sites.filter((s, i) => inCell(cells[i]!, x - s.x, z - s.z))
      expect(owners.length, `(${x}, ${z})`).toBe(1)
      expect(Math.hypot(x - owners[0]!.x, z - owners[0]!.z)).toBeLessThanOrEqual(owners[0]!.radiusM + 1e-9)
    }
    expect(tested).toBeGreaterThan(1000)
  })

  it('gives the later of two coincident layers an empty cell', () => {
    const [a, b] = streetCells([site('A', 10, 10), site('B', 10, 10)])
    expect(a).toBe(NO_CELL)
    expect(b!.key).toBe('!A')
    expect(clipToCell(segment(-100, 0, 100, 0), b!).positions.length).toBe(0)
  })

  it('changes the key when an overlapping neighbour joins, not a far one', () => {
    const base = streetCells([site('A', 0, 0), site('B', 300, 0)])[0]!.key
    expect(streetCells([site('A', 0, 0), site('B', 300, 0), site('F', 2000, 0)])[0]!.key).toBe(base)
    expect(streetCells([site('A', 0, 0), site('B', 300, 0), site('C', -200, 0)])[0]!.key).toBe('B,C')
  })

  it('drops a segment wholly outside the cell and keeps one wholly inside unchanged', () => {
    const [a] = streetCells([site('A', 0, 0), site('B', 300, 0)])
    expect(clipToCell(segment(200, -10, 250, 10), a!).positions.length).toBe(0)
    const kept = clipToCell(segment(-50, -10, 50, 10), a!)
    expect(Array.from(kept.positions)).toEqual([-50, 0, -10, 50, 0, 10])
  })
})
