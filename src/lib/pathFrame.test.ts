import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import { quickestExit, type ExitChoice } from './exitChoice'
import { priorityFrameOf, priorityLanding, priorityTiers } from './pathFrame'
import { framedCount } from './freeFrame'
import { fixture } from './interiorFixture'
import { frameInterior } from './interiorCamera'
import { interiorFocusAnchor } from './interiorFraming'
import { exitPathCenterline } from './interiorPath'
import { panRadius } from './orbitLimits'
import { toGround } from './projection'
import { ISO_POLAR } from './tilt'

const sources: Connector['sources'] = ['authored']
const stair = (id: string, lower: [number, number, string], upper: [number, number, string]): Connector => ({
  id,
  kind: 'stair',
  lower: { x: lower[0], z: lower[1], level: lower[2] },
  upper: { x: upper[0], z: upper[1], level: upper[2] },
  width: 2,
  sources,
})

/** Platform stair PS1 up to a wide mezzanine, ST1 out to the street at E1 (9, 10). */
function station(): StationInterior {
  const base = fixture([stair('PS1', [-10, 2, 'plat'], [-10, 8, 'mezz']), stair('ST1', [0, 10, 'mezz'], [7, 10, 'street'])])
  return { ...base, slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }] }
}

const Y = 2
const OPTS = { stepRise: 0.18, railDrop: 1.1, boardHalfM: 9 }
const interior = station()
const origin = toGround(interior.anchor)
const model = { stationId: 'X01', interior, origin, yScale: Y, focusAnchor: interiorFocusAnchor(origin, interior, Y, Math.tan(ISO_POLAR)) }
const choice = (): ExitChoice => {
  const r = quickestExit({ interior, stopId: 'X01N' })
  if (r.kind !== 'exit') throw new Error(r.reason)
  return r
}

afterEach(() => vi.restoreAllMocks())

describe('priorityFrameOf with a path', () => {
  it('wants the board ends, then the centerline, then the outline, nearest the board first, in scene meters', () => {
    const f = priorityFrameOf(model, choice(), [], [origin], OPTS)!
    const line = exitPathCenterline(interior, choice(), { yScale: Y, stepRise: OPTS.stepRise })
    expect(f.pathCount).toBe(2 + line.length)
    // The board marker: 18 m of the track at z -5, centred under PS1's foot (x -10), at rail height.
    const railY = (-8 - OPTS.railDrop) * Y
    expect(f.wanted.slice(0, 2).map((p) => [p.x - origin.x, p.y, p.z - origin.z])).toEqual([
      [-19, railY, -5],
      [-1, railY, -5],
    ])
    line.forEach((q, i) => expect(f.wanted[2 + i]).toEqual({ x: origin.x + q.p[0], y: q.p[1], z: origin.z + q.p[2] }))
    const hull = f.wanted.slice(f.pathCount)
    // The platform's four corners at its level, the mezzanine's at its, and the entrance on the street.
    expect(hull).toHaveLength(9)
    const mid = { x: origin.x - 10, z: origin.z - 5 }
    const d = hull.map((p) => Math.hypot(p.x - mid.x, p.z - mid.z))
    expect(d).toEqual([...d].sort((a, b) => a - b))
    expect(f.center).toEqual({ x: origin.x, y: -8, z: origin.z + 6 })
    expect(f.centerRadius).toBe(panRadius(model.focusAnchor.reach))
  })

  it('adds the walk outside after the outline', () => {
    const walk = { kind: 'route' as const, points: [{ x: origin.x + 9, z: origin.z + 10 }, { x: origin.x + 40, z: origin.z + 30 }], meters: 40, seconds: 30 }
    const f = priorityFrameOf(model, { ...choice(), walk }, [], [origin], OPTS)!
    expect(f.wanted.slice(-2)).toEqual(walk.points.map((g) => ({ x: g.x, y: 0, z: g.z })))
  })

  it("returns null, logging once, for a choice that doesn't fit the interior", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(priorityFrameOf(model, { ...choice(), connectorIds: ['NOPE'] }, [], [origin], OPTS)).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('priorityLanding with a path', () => {
  const f = priorityFrameOf(model, choice(), [], [origin], OPTS)!
  const path = f.wanted.slice(0, f.pathCount)
  const desk = { azimuth: 0, viewport: { width: 1440, height: 900 }, free: { left: 0, top: 60, right: 1120, bottom: 833 }, fovDeg: 35 }

  it('keeps the usual landing when it already shows the whole path', () => {
    const plain = frameInterior({ ...model.focusAnchor, ...desk })
    expect(framedCount(desk, plain, path)).toBe(path.length)
    expect(priorityLanding(f, desk, plain)).toBe(plain)
  })

  it('frames the path instead when the usual landing leaves it out', () => {
    const phone = { ...desk, viewport: { width: 390, height: 844 }, free: { left: 0, top: 60, right: 390, bottom: 560 } }
    // A usual landing far off the path (as a big interior's centre would be).
    const plain = { distance: 400, target: { x: origin.x + 300, z: origin.z } }
    expect(framedCount(phone, plain, path)).toBe(0)
    const landing = priorityLanding(f, phone, plain)
    expect(landing).not.toBe(plain)
    expect(framedCount(phone, landing, path)).toBe(path.length)
  })
})

describe('priorityFrameOf with machines out of service', () => {
  // Two machine ends at the platform's west end, one on each level they join.
  const outages = [
    { x: origin.x - 18, y: -8 * Y, z: origin.z },
    { x: origin.x - 18, y: -4 * Y, z: origin.z + 6 },
  ]

  it('wants the path, then the machines, then the outline, then the walk', () => {
    const walk = { kind: 'route' as const, points: [{ x: origin.x + 40, z: origin.z + 30 }], meters: 40, seconds: 30 }
    const bare = priorityFrameOf(model, { ...choice(), walk }, [], [origin], OPTS)!
    const f = priorityFrameOf(model, { ...choice(), walk }, outages, [origin], OPTS)!
    expect(f.pathCount).toBe(bare.pathCount)
    expect(f.outageCount).toBe(2)
    expect(f.wanted).toEqual([...bare.wanted.slice(0, bare.pathCount), ...outages, ...bare.wanted.slice(bare.pathCount)])
    expect(priorityTiers(f)).toEqual([bare.wanted.slice(0, bare.pathCount), outages])
  })

  it('with no path wants the machines first, then the outline nearest them', () => {
    const f = priorityFrameOf(model, null, outages, [origin], OPTS)!
    expect(f.pathCount).toBe(0)
    expect(f.wanted.slice(0, 2)).toEqual(outages)
    const hull = f.wanted.slice(2)
    expect(hull).toHaveLength(9)
    const d = hull.map((p) => Math.hypot(p.x - (origin.x - 18), p.z - (origin.z + 3)))
    expect(d).toEqual([...d].sort((a, b) => a - b))
    expect(f.centerRadius).toBe(panRadius(model.focusAnchor.reach))
  })

  it('is null with neither, and frames the machines alone when the path does not fit (logging once)', () => {
    expect(priorityFrameOf(model, null, [], [origin], OPTS)).toBeNull()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = priorityFrameOf(model, { ...choice(), connectorIds: ['NOPE'] }, outages, [origin], OPTS)!
    expect(error).toHaveBeenCalledTimes(1)
    expect(f.pathCount).toBe(0)
    expect(f.wanted.slice(0, 2)).toEqual(outages)
  })
})

describe('priorityLanding with machines out of service', () => {
  const phone = { azimuth: 0, viewport: { width: 390, height: 844 }, free: { left: 0, top: 60, right: 390, bottom: 560 }, fovDeg: 35 }
  const near = [{ x: origin.x - 18, y: -8 * Y, z: origin.z }]

  it('keeps the usual landing when it shows every machine', () => {
    const f = priorityFrameOf(model, null, near, [origin], OPTS)!
    const plain = frameInterior({ ...model.focusAnchor, ...phone })
    expect(framedCount(phone, plain, near)).toBe(1)
    expect(priorityLanding(f, phone, plain)).toBe(plain)
  })

  it('frames the machines when the usual landing leaves them out', () => {
    const f = priorityFrameOf(model, null, near, [origin], OPTS)!
    const plain = { distance: 400, target: { x: origin.x + 300, z: origin.z } }
    const landing = priorityLanding(f, phone, plain)
    expect(landing).not.toBe(plain)
    expect(framedCount(phone, landing, near)).toBe(1)
  })

  it('never gives up any of the path for a machine', () => {
    // A machine 400 m off: no landing within 100 m of the station shows it, so the usual landing, which shows the whole path, stays.
    const far = [{ x: origin.x + 400, y: 0, z: origin.z }]
    const f = priorityFrameOf(model, choice(), far, [origin], OPTS)!
    const [path] = priorityTiers(f)
    const plain = frameInterior({ ...model.focusAnchor, ...phone })
    expect(framedCount(phone, plain, path)).toBe(path.length)
    expect(priorityLanding(f, phone, plain)).toBe(plain)
  })
})
