import { describe, expect, it } from 'vitest'
import { vertexBandInputs } from '../lineBuffers'
import { buildPolyline } from '../realtime/polyline'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { buildTrackProfile, EMPTY_PROFILE, GRADE } from '../trackProfile'
import { PITCH, pxApart, replay, viewAt } from './carryReplay'
import { CARRY_MAX_S, CARRY_MIN_S, carryDurationFor, carryInto } from './shapeCarry'
import { createSlotTable } from './slots'
import { createTrackPoint, trackPointInto } from './trackPoint'

function geometry(shapeId: string, points: { x: number; z: number }[], slot: number, half: number, profile = EMPTY_PROFILE): ShapeGeometry {
  const line = buildPolyline(points)
  return {
    shapeId,
    line,
    stops: ['x', 'y'],
    stopDistances: [0, line.length],
    maxStopOffsetM: 0,
    profile,
    bandInputs: vertexBandInputs(points, points.map(() => slot), points.map(() => half)),
  }
}

/** Northbound along x = 0 for 2 km, a vertex every 100 m. */
const straight = (id: string, slot: number) =>
  geometry(id, Array.from({ length: 21 }, (_, i) => ({ x: 0, z: -100 * i })), slot, 0.5)

describe('a shape change on a shared corridor', () => {
  it.each([600, 1500])('slides from slot -0.5 to +0.5 with no jump over 1 px at %i m', (distance) => {
    const from = straight('A', -0.5)
    const to = straight('B', 0.5)
    const v = viewAt({ x: 0, z: -800 }, distance)
    // What the ground projection did: the same distance on the other band, a full pitch over.
    const a = trackPointInto(from, 800, v, createTrackPoint())
    expect(pxApart(v, a, trackPointInto(to, 800, v, createTrackPoint()))).toBeCloseTo(PITCH, 0)
    const r = replay(from, 800, to, v)
    expect(r.carried).toBe(true)
    expect(r.jumpPx).toBeLessThan(1e-6)
    expect(r.stepPx).toBeLessThan(0.2)
    expect(r.endPx).toBeLessThan(1e-6)
  })

  it('keeps a train on a ramp at its drawn height, tilted', () => {
    const profile = buildTrackProfile([{ d0: 700, d1: 900, yReal: -10 }], { grade: GRADE, yScale: 2 }).profile
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: 0, z: -100 * i }))
    const from = geometry('A', pts, -0.5, 0.5, profile)
    const to = geometry('B', pts, 0.5, 0.5)
    const v = viewAt({ x: 0, z: -800 }, 300)
    const r = replay(from, 800, to, v)
    expect(r.jumpPx).toBeLessThan(1e-6)
    expect(r.stepPx).toBeLessThan(1)
    expect(r.endPx).toBeLessThan(1e-6)
  })
})

describe('a shape change at a junction', () => {
  // A shared trunk north to z = -1000, then the two branches part east and west (about 1 in 2).
  const trunk = Array.from({ length: 11 }, (_, i) => ({ x: 0, z: -100 * i }))
  const east = geometry('E', [...trunk, { x: 50, z: -1100 }, { x: 300, z: -1600 }], -0.5, 0.5)
  const west = geometry('W', [...trunk, { x: -50, z: -1100 }, { x: -300, z: -1600 }], 0.5, 0.5)

  it.each([980, 1000, 1010, 1020])('carries over within 1 px at %i m along, both ways', (d) => {
    const v = viewAt({ x: 0, z: -1000 }, 600)
    for (const [a, b] of [[east, west], [west, east]] as const) {
      const r = replay(a, d, b, v)
      expect(r.carried, `${a.shapeId}->${b.shapeId}`).toBe(true)
      expect(r.jumpPx).toBeLessThan(1)
      expect(r.stepPx).toBeLessThan(1)
      expect(r.endPx).toBeLessThan(1e-6)
    }
  })

  it('cross-fades once the branches are more than CARRY_M apart as drawn', () => {
    const v = viewAt({ x: 0, z: -1300 }, 600)
    const r = replay(east, 1250, west, v)
    expect(r.carried).toBe(false)
  })

  it('cross-fades a gap over CARRY_MAX_PX on screen, which the same gap farther out slides', () => {
    // 1030 m along, the drawn branches are about 25 m apart: 186 px at 180 m, under 40 px at 1000 m.
    expect(replay(east, 1030, west, viewAt({ x: 0, z: -1000 }, 180)).carried).toBe(false)
    const far = replay(east, 1030, west, viewAt({ x: 0, z: -1000 }, 1000))
    expect(far.carried && far.offset).toBe(true)
  })
})

describe('a shape change under reduced motion', () => {
  it('cross-fades a gap over 1 px instead of sliding', () => {
    const v = viewAt({ x: 0, z: -800 }, 600)
    const r = replay(straight('A', -0.5), 800, straight('B', 0.5), v, true)
    expect(r.carried).toBe(false)
    expect(r.offset).toBe(false)
  })

  it('snaps a gap under 1 px with no offset', () => {
    const v = viewAt({ x: 0, z: -800 }, 600)
    const r = replay(straight('A', 0.5), 800, straight('B', 0.5), v, true)
    expect(r.carried).toBe(true)
    expect(r.offset).toBe(false)
    expect(r.jumpPx).toBeLessThan(1)
    expect(r.endPx).toBeLessThan(1e-6)
  })
})

describe('carryInto', () => {
  it('eases the recorded offset out over its duration and is zero with none', () => {
    const t = createSlotTable(1)
    const p = createTrackPoint()
    expect(carryInto(t.carry, 0, 5, p)).toEqual({ x: 0, y: 0, z: 0 })
    t.carry.x[0] = 2
    t.carry.at[0] = 5
    t.carry.dur[0] = 1
    expect(carryInto(t.carry, 0, 5, p).x).toBe(2)
    expect(carryInto(t.carry, 0, 5.5, p).x).toBeCloseTo(1)
    expect(carryInto(t.carry, 0, 6, p).x).toBe(0)
  })

  it('sizes the ease by the gap on screen, within its bounds', () => {
    expect(carryDurationFor(2.5)).toBe(CARRY_MIN_S)
    expect(carryDurationFor(42)).toBeCloseTo(1.4)
    expect(carryDurationFor(500)).toBe(CARRY_MAX_S)
    expect(carryDurationFor(NaN)).toBe(CARRY_MIN_S)
  })
})
