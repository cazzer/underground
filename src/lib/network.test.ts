import { describe, expect, it, vi } from 'vitest'
import { decodeShapePoints, deltaEncode } from '../data/codec'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { StationDepthsFile } from '../data/stationSchema'
import { buildNetwork, pointAlong, stationAccess, type ShapePath } from './network'
import { toGround } from './projection'
import { EMPTY_PROFILE, profileAt } from './trackProfile'

const FV = 'v1'
const NO_DEPTHS: StationDepthsFile = { license: 'ODbL-1.0', attribution: [], stations: [] }

function stationsFile(): StationsFile {
  return {
    feedVersion: FV,
    stations: [
      { id: '101', name: 'North', lat: 40.8, lon: -73.9, stops: ['101N', '101S'], routes: ['1'], borough: 'Bx', ada: 'full' },
      { id: '102', name: 'South', lat: 40.7, lon: -74.0, stops: ['102N', '102S'], routes: ['1', '2'], borough: 'Bx', ada: 'none' },
    ],
  }
}

function routesFile(): RoutesFile {
  return {
    feedVersion: FV,
    routes: [
      { id: '1', shortName: '1', longName: 'Broadway Local', color: 'EE352E', textColor: 'FFFFFF' },
      { id: '2', shortName: '2', longName: '7 Av Express', color: 'EE352E', textColor: 'FFFFFF' },
    ],
  }
}

// One shape point (lon -74.1) lies west of every station.
const LAT = [4070000, 4075000, 4080000]
const LON = [-7400000, -7410000, -7390000]

function shapesFile(): ShapesFile {
  return {
    feedVersion: FV,
    shapes: [{ id: '1..N01R', routeId: '1', direction: 'N', primary: true, lat: deltaEncode(LAT), lon: deltaEncode(LON) }],
  }
}

describe('buildNetwork', () => {
  const net = buildNetwork(stationsFile(), routesFile(), shapesFile(), 0, NO_DEPTHS, 2)

  it('decodes and projects shape points', () => {
    const shape = shapesFile().shapes[0]!
    expect(net.shapes[0]!.points).toEqual(decodeShapePoints(shape).map((p) => toGround(p)))
  })

  it('computes cumulative distances and length', () => {
    const { points, cumulative, length } = net.shapes[0]!
    const d1 = Math.hypot(points[1]!.x - points[0]!.x, points[1]!.z - points[0]!.z)
    const d2 = Math.hypot(points[2]!.x - points[1]!.x, points[2]!.z - points[1]!.z)
    expect(cumulative[0]).toBe(0)
    expect(cumulative[1]).toBeCloseTo(d1)
    expect(length).toBeCloseTo(d1 + d2)
  })

  it('prefixes route colors with # and keeps route order', () => {
    expect(net.routes.map((r) => r.id)).toEqual(['1', '2'])
    expect(net.routes[0]!.color).toBe('#EE352E')
  })

  it('gives stations their route ids and indexes stations and routes', () => {
    expect(net.stations[1]!.routeIds).toEqual(['1', '2'])
    expect([...net.stationById.keys()]).toEqual(['101', '102'])
    expect(net.stationById.get('102')!.name).toBe('South')
    expect([...net.routeById.keys()]).toEqual(['1', '2'])
  })

  it('includes shape points outside the stations in the bounds', () => {
    const west = toGround({ lat: 40.75, lon: -74.1 }).x
    expect(net.bounds.minX).toBeCloseTo(west)
    expect(net.bounds.maxX).toBeCloseTo(toGround({ lat: 40.8, lon: -73.9 }).x)
  })

  it('centers on the bounds midpoint', () => {
    const { bounds, center } = net
    expect(center).toEqual({ x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 })
  })

  it('throws on mismatched feed versions', () => {
    expect(() => buildNetwork(stationsFile(), { ...routesFile(), feedVersion: 'v2' }, shapesFile(), 0, NO_DEPTHS, 2)).toThrow(/v2/)
  })

  it('throws on a shape with an unknown route', () => {
    const shapes = shapesFile()
    shapes.shapes[0]!.routeId = 'X'
    expect(() => buildNetwork(stationsFile(), routesFile(), shapes, 0, NO_DEPTHS, 2)).toThrow(/unknown route "X"/)
  })

  it('throws on a shape with one point', () => {
    const shapes = shapesFile()
    shapes.shapes[0]!.lat = [4070000]
    shapes.shapes[0]!.lon = [-7400000]
    expect(() => buildNetwork(stationsFile(), routesFile(), shapes, 0, NO_DEPTHS, 2)).toThrow(/1 point/)
  })

  it('throws without stations', () => {
    expect(() => buildNetwork({ feedVersion: FV, stations: [] }, routesFile(), shapesFile(), 0, NO_DEPTHS, 2)).toThrow(/no stations/)
  })
})

describe('buildNetwork track offset', () => {
  it('moves shape points right of travel and measures length on the offset path', () => {
    const plain = buildNetwork(stationsFile(), routesFile(), shapesFile(), 0, NO_DEPTHS, 2).shapes[0]!
    const shifted = buildNetwork(stationsFile(), routesFile(), shapesFile(), 4.7, NO_DEPTHS, 2).shapes[0]!
    const [a, b] = [plain.points[0]!, plain.points[1]!]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    // Right normal of tangent (tx, tz) is (-tz, tx).
    expect(shifted.points[0]!.x).toBeCloseTo(a.x - ((b.z - a.z) / len) * 4.7)
    expect(shifted.points[0]!.z).toBeCloseTo(a.z + ((b.x - a.x) / len) * 4.7)
    expect(shifted.points).toHaveLength(plain.points.length)
    expect(shifted.cumulative.at(-1)).toBe(shifted.length)
    expect(buildNetwork(stationsFile(), routesFile(), shapesFile(), 4.7, NO_DEPTHS, 2).trackOffsetM).toBe(4.7)
  })
})

describe('buildNetwork track profile', () => {
  it('keeps every shape at y = 0 with no station depths', () => {
    const net = buildNetwork(stationsFile(), routesFile(), shapesFile(), 4.7, NO_DEPTHS, 2)
    expect(net.profiles.size).toBe(0)
    expect(net.stationTrackY.size).toBe(0)
    for (const s of net.shapes) {
      expect(s.profile).toBe(EMPTY_PROFILE)
      expect(s.y).toEqual(s.points.map(() => 0))
    }
  })

  // Platform tracks laid along the shape's first segment, [from, to] meters around the point nearest `anchor`.
  const [a, b] = decodeShapePoints(shapesFile().shapes[0]!).map((p) => toGround(p))
  const anchor = { lat: 40.725, lon: -74.05 }
  const g = toGround(anchor)
  const len = Math.hypot(b!.x - a!.x, b!.z - a!.z)
  const [ux, uz] = [(b!.x - a!.x) / len, (b!.z - a!.z) / len]
  const t = (g.x - a!.x) * ux + (g.z - a!.z) * uz
  const end = (s: number): [number, number] => [a!.x + ux * (t + s) - g.x, a!.z + uz * (t + s) - g.z]
  const station = (stationId: string, railY: number, from: number, to: number, stops = [stationId + 'N']) => ({
    stationId,
    anchor,
    tracks: stops.map((stopId) => ({ stopId, railY, ends: [end(from), end(to)] as [[number, number], [number, number]] })),
  })
  const build = (...stations: ReturnType<typeof station>[]) =>
    buildNetwork(stationsFile(), routesFile(), shapesFile(), 0, { ...NO_DEPTHS, stations }, 2)

  it('descends a shape to a station depth it rides, scaled by yScale, and warns about a track nobody rides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const net = build(station('101', -10.2, -50, 50, ['101N', '101S']))
    const shape = net.shapes[0]!
    expect(net.stationTrackY).toEqual(new Map([['101', -20.4]]))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/101S/)
    warn.mockRestore()
    expect(profileAt(shape.profile, t)).toBeCloseTo(-20.4, 9)
    expect(shape.y[0]).toBe(0)
    expect(shape.y.at(-1)).toBe(0)
    expect(Math.min(...shape.y)).toBeCloseTo(-20.4, 9)
    shape.y.forEach((y, i) => expect(y).toBe(profileAt(shape.profile, shape.cumulative[i]!)))
  })

  it('takes an elevated station at its own height, not clamped to the street', () => {
    expect(build(station('101', 6, -50, 50)).stationTrackY).toEqual(new Map([['101', 12]]))
  })

  it('gives no tie depth to a station whose run the profile dropped as overlapping', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const net = build(station('101', -10, -50, 50), station('102', -6, 0, 100))
    expect(net.stationTrackY).toEqual(new Map([['101', -20]]))
    expect(warn.mock.calls.some(([m]) => /overlapping/.test(String(m)))).toBe(true)
    warn.mockRestore()
  })
})

function path(points: { x: number; z: number }[]): ShapePath {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  return { id: 's', routeId: 'r', direction: 'N', primary: true, points, cumulative, length: cumulative.at(-1) ?? 0, y: points.map(() => 0), profile: EMPTY_PROFILE }
}

describe('stationAccess', () => {
  it('carries full and partial status, with the partial note', () => {
    expect(stationAccess({ ada: 'full' })).toEqual({ status: 'full' })
    expect(stationAccess({ ada: 'partial', adaPartial: { north: false, south: true, note: 'Uptown only' } })).toEqual({
      status: 'partial',
      note: 'Uptown only',
    })
  })

  it('reads a station from an older file without the fields as not accessible', () => {
    expect(stationAccess({})).toEqual({ status: 'none' })
  })

  it('reaches the render stations, borough included', () => {
    const net = buildNetwork(stationsFile(), routesFile(), shapesFile(), 0, NO_DEPTHS, 2)
    expect(net.stations.map((s) => [s.borough, s.access.status])).toEqual([
      ['Bx', 'full'],
      ['Bx', 'none'],
    ])
  })
})

describe('pointAlong', () => {
  it('returns the only point of a one-point path', () => {
    expect(pointAlong(path([{ x: 3, z: 4 }]), 10)).toEqual({ x: 3, z: 4 })
  })

  it('throws for a path without points', () => {
    expect(() => pointAlong(path([]), 0)).toThrow()
  })

  it('interpolates to the midpoint of a two-point path', () => {
    expect(pointAlong(path([{ x: 0, z: 0 }, { x: 10, z: 20 }]), Math.hypot(10, 20) / 2)).toEqual({ x: 5, z: 10 })
  })

  it('writes into the provided out object', () => {
    const out = { x: 0, z: 0 }
    expect(pointAlong(path([{ x: 0, z: 0 }, { x: 10, z: 0 }]), 4, out)).toBe(out)
    expect(out).toEqual({ x: 4, z: 0 })
  })
})
