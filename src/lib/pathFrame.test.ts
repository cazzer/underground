import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import { quickestExit, type ExitChoice } from './exitChoice'
import { stationPathFrameOf, pathLanding } from './pathFrame'
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

describe('stationPathFrameOf', () => {
  it('wants the board ends, then the centerline, then the outline, nearest the board first, in scene meters', () => {
    const f = stationPathFrameOf(model, choice(), [origin], OPTS)!
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
    const f = stationPathFrameOf(model, { ...choice(), walk }, [origin], OPTS)!
    expect(f.wanted.slice(-2)).toEqual(walk.points.map((g) => ({ x: g.x, y: 0, z: g.z })))
  })

  it("returns null, logging once, for a choice that doesn't fit the interior", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(stationPathFrameOf(model, { ...choice(), connectorIds: ['NOPE'] }, [origin], OPTS)).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('pathLanding', () => {
  const f = stationPathFrameOf(model, choice(), [origin], OPTS)!
  const path = f.wanted.slice(0, f.pathCount)
  const desk = { azimuth: 0, viewport: { width: 1440, height: 900 }, free: { left: 0, top: 60, right: 1120, bottom: 833 }, fovDeg: 35 }

  it('keeps the usual landing when it already shows the whole path', () => {
    const plain = frameInterior({ ...model.focusAnchor, ...desk })
    expect(framedCount(desk, plain, path)).toBe(path.length)
    expect(pathLanding(f, desk, plain)).toBe(plain)
  })

  it('frames the path instead when the usual landing leaves it out', () => {
    const phone = { ...desk, viewport: { width: 390, height: 844 }, free: { left: 0, top: 60, right: 390, bottom: 560 } }
    // A usual landing far off the path (as a big interior's centre would be).
    const plain = { distance: 400, target: { x: origin.x + 300, z: origin.z } }
    expect(framedCount(phone, plain, path)).toBe(0)
    const landing = pathLanding(f, phone, plain)
    expect(landing).not.toBe(plain)
    expect(framedCount(phone, landing, path)).toBe(path.length)
  })
})
