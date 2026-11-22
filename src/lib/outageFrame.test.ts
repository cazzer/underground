import { describe, expect, it } from 'vitest'
import type { Connector } from '../data/stationSchema'
import { BANK_GAP_M } from './escalatorBanks'
import { stationAxis } from './interiorAxis'
import { ELEVATOR, fixture, STAIR } from './interiorFixture'
import { outageFramePoints } from './outageFrame'
import { toGround } from './projection'

const Y = 2
const escalator = (id: string, lower: [number, number, string], upper: [number, number, string], width = 1.2): Connector => ({
  id,
  kind: 'escalator',
  lower: { x: lower[0], z: lower[1], level: lower[2] },
  upper: { x: upper[0], z: upper[1], level: upper[2] },
  width,
  sources: ['nyopendata'],
})

const interior = fixture([STAIR, ELEVATOR, escalator('ES1', [-12, 4, 'plat'], [-12, 12, 'mezz']), escalator('ES2', [0, 10, 'mezz'], [0, 10, 'street'])])
const origin = toGround(interior.anchor)
const model = { interior, origin }
const local = (p: { x: number; y: number; z: number }) => [p.x - origin.x, p.y, p.z - origin.z]

describe('outageFramePoints', () => {
  it("takes an elevator's shaft at both its stops, lower first, in scene meters at y × yScale", () => {
    const pts = outageFramePoints(model, ['EL1'], Y).map(local)
    expect(pts).toEqual([
      [3, -8 * Y, 0],
      [3, -4 * Y, 0],
    ])
  })

  it("takes an escalator's own ends when it has a run", () => {
    expect(outageFramePoints(model, ['ES1'], Y).map(local)).toEqual([
      [-12, -8 * Y, 4],
      [-12, -4 * Y, 12],
    ])
  })

  it('lays a zero-run escalator on its drawn 30 degree run along the station axis, centred on its point', () => {
    const [lower, upper] = outageFramePoints(model, ['ES2'], Y).map(local)
    expect(lower![1]).toBe(-4 * Y)
    expect(upper![1]).toBe(0)
    const run = [upper![0]! - lower![0]!, upper![2]! - lower![2]!]
    // Rise 4 m at 30 degrees: 4√3 of plan run, along the axis, the middle on its own point.
    expect(Math.hypot(run[0]!, run[1]!)).toBeCloseTo(4 * Math.sqrt(3), 6)
    const axis = stationAxis(interior)
    expect(Math.abs(run[0]! * axis[1] - run[1]! * axis[0])).toBeLessThan(1e-9)
    expect((lower![0]! + upper![0]!) / 2).toBeCloseTo(0, 6)
    expect((lower![2]! + upper![2]!) / 2).toBeCloseTo(10, 6)
  })

  it('spreads a bank of zero-run escalators across the axis as they are drawn', () => {
    const banked = fixture([escalator('ES3', [0, 10, 'mezz'], [0, 10, 'street']), escalator('ES4', [0, 10, 'mezz'], [0, 10, 'street'])])
    const [a, , b] = outageFramePoints({ interior: banked, origin }, ['ES3', 'ES4'], Y).map(local)
    expect(Math.hypot(a![0]! - b![0]!, a![2]! - b![2]!)).toBeCloseTo(1.2 + BANK_GAP_M, 6)
  })

  it('follows the ids given and skips any that is not an elevator or escalator here', () => {
    const pts = outageFramePoints(model, ['ES1', 'NOPE', 'ST1', 'EL1'], Y).map(local)
    expect(pts.map((p) => p[0])).toEqual([-12, -12, 3, 3])
    expect(outageFramePoints(model, [], Y)).toEqual([])
  })
})
