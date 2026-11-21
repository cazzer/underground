import { describe, expect, it } from 'vitest'
import { decodeShapePoints, deltaEncode } from '../data/codec'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import { buildNetwork, pointAlong, type ShapePath } from './network'
import { toGround } from './projection'

const FV = 'v1'

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
  const net = buildNetwork(stationsFile(), routesFile(), shapesFile(), 0)

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
    expect(() => buildNetwork(stationsFile(), { ...routesFile(), feedVersion: 'v2' }, shapesFile(), 0)).toThrow(/v2/)
  })

  it('throws on a shape with an unknown route', () => {
    const shapes = shapesFile()
    shapes.shapes[0]!.routeId = 'X'
    expect(() => buildNetwork(stationsFile(), routesFile(), shapes, 0)).toThrow(/unknown route "X"/)
  })

  it('throws on a shape with one point', () => {
    const shapes = shapesFile()
    shapes.shapes[0]!.lat = [4070000]
    shapes.shapes[0]!.lon = [-7400000]
    expect(() => buildNetwork(stationsFile(), routesFile(), shapes, 0)).toThrow(/1 point/)
  })

  it('throws without stations', () => {
    expect(() => buildNetwork({ feedVersion: FV, stations: [] }, routesFile(), shapesFile(), 0)).toThrow(/no stations/)
  })
})

describe('buildNetwork track offset', () => {
  it('moves shape points right of travel and measures length on the offset path', () => {
    const plain = buildNetwork(stationsFile(), routesFile(), shapesFile(), 0).shapes[0]!
    const shifted = buildNetwork(stationsFile(), routesFile(), shapesFile(), 4.7).shapes[0]!
    const [a, b] = [plain.points[0]!, plain.points[1]!]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    // Right normal of tangent (tx, tz) is (-tz, tx).
    expect(shifted.points[0]!.x).toBeCloseTo(a.x - ((b.z - a.z) / len) * 4.7)
    expect(shifted.points[0]!.z).toBeCloseTo(a.z + ((b.x - a.x) / len) * 4.7)
    expect(shifted.points).toHaveLength(plain.points.length)
    expect(shifted.cumulative.at(-1)).toBe(shifted.length)
    expect(buildNetwork(stationsFile(), routesFile(), shapesFile(), 4.7).trackOffsetM).toBe(4.7)
  })
})

function path(points: { x: number; z: number }[]): ShapePath {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  return { id: 's', routeId: 'r', direction: 'N', primary: true, points, cumulative, length: cumulative.at(-1) ?? 0 }
}

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
